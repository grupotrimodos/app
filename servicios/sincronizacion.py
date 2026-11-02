"""Sincronización automática con Odoo: cada dato va solo a su sitio.

MAPAS dice, para cada tipo de dato, qué aplicación de Odoo lo guarda, hacia dónde va y quién manda (la «fuente de
verdad»). Antes de enviar nada se mira qué aplicaciones están instaladas en Odoo: lo que no tiene su aplicación se
salta y se explica en la pantalla «Sincronización» (nunca se fuerza ni se inventa un sitio).

  · Odoo manda → la app lo lee:   fichas de empleado (enlace automático), flota de camiones.
  · La app manda → Odoo lo recibe: fichajes (asistencias) y ausencias aprobadas.

Se lanza sola (cron de Vercel, con CRON_SECRET) o con el botón de la pantalla (permiso «admin.sincronizacion»).
Usa la clave de servidor de Supabase porque envía lo pendiente de todas las personas. Cada envío también se intenta al
momento desde la propia acción del usuario; esto es la red de seguridad (reintentos, enlaces nuevos, flota).
Para añadir un dato nuevo: una entrada en MAPAS y su función en PASOS.
"""
from __future__ import annotations

import hmac
import logging
import os
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header

from . import rrhh, supa
from .auth import Usuario, requiere_permiso
from .errors import AppError

log = logging.getLogger("conductores")
router = APIRouter(prefix="/api/odoo", tags=["odoo"])
con_permiso = requiere_permiso("admin.sincronizacion")
TIEMPO_MAX = 20     # segundos por pasada (Vercel corta a los 30): lo que falte sale en la siguiente
PENDIENTES = "in.(pendiente,error,sin_empleado)"

MAPAS = [
    {"id": "empleados", "nombre": "Fichas de empleado", "app_odoo": "hr", "nombre_app": "Empleados",
     "modelo": "hr.employee", "sentido": "odoo_a_app",
     "que_hace": "Enlaza a cada persona con su ficha de empleado de Odoo por su correo de trabajo o su código de credencial."},
    {"id": "fichajes", "nombre": "Fichajes", "app_odoo": "hr_attendance", "nombre_app": "Asistencias",
     "modelo": "hr.attendance", "sentido": "app_a_odoo",
     "que_hace": "Cada entrada, pausa y salida se anota como asistencia de su empleado."},
    {"id": "ausencias", "nombre": "Vacaciones y ausencias", "app_odoo": "hr_holidays", "nombre_app": "Ausencias",
     "modelo": "hr.leave", "sentido": "app_a_odoo",
     "que_hace": "Las ausencias aprobadas se crean en Odoo con el tipo que corresponde por su nombre."},
    {"id": "vehiculos", "nombre": "Camiones", "app_odoo": "fleet", "nombre_app": "Flota",
     "modelo": "fleet.vehicle", "sentido": "odoo_a_app",
     "que_hace": "Los vehículos activos de la flota de Odoo aparecen solos en la lista de camiones de la app."},
]


def _odoo():
    return rrhh._odoo()


def aplicaciones(odoo) -> dict[str, bool | None]:
    """Para cada mapa: True (instalada), False (no instalada) o None (Odoo no deja consultarlo: se intenta igual)."""
    instaladas = odoo.modulos_instalados([m["app_odoo"] for m in MAPAS])
    return {m["id"]: None if instaladas is None else m["app_odoo"] in instaladas for m in MAPAS}


# ------------------------------------------------------------------ pasos (uno por mapa)

def _paso_empleados(limite: float) -> dict:
    filas = supa.leer(supa.SERVICIO, "usuarios", {"activo": "eq.true", "odoo_employee_id": "is.null", "select": "id"})
    enlazados = sin = 0
    for f in filas:
        if time.monotonic() > limite:
            break
        emp, _ = rrhh.empleado(supa.SERVICIO, f["id"])
        enlazados += bool(emp)
        sin += not emp
    r = {"enlazados": enlazados, "sin_ficha": sin}
    if not rrhh.guardar_enlaces():
        r["aviso"] = "Odoo en modo simulado: no se guarda ningún enlace."
    return r


def _paso_fichajes(limite: float) -> dict:
    filas = supa.leer(supa.SERVICIO, "fichajes", {"odoo_estado": PENDIENTES, "select": "usuario_id"})
    total = {"personas": 0, "enviados": 0, "errores": 0, "sin_empleado": 0}
    for uid in dict.fromkeys(f["usuario_id"] for f in filas):
        if time.monotonic() > limite:
            break
        r = rrhh.enviar_fichajes(supa.SERVICIO, uid)
        total["personas"] += 1
        for k in ("enviados", "errores", "sin_empleado"):
            total[k] += r.get(k, 0)
    return total


def _paso_ausencias(limite: float) -> dict:
    filas = supa.leer(supa.SERVICIO, "ausencias", {"estado": "eq.aprobada", "odoo_estado": PENDIENTES, "select": "id"})
    total: dict[str, int] = {}
    for f in filas:
        if time.monotonic() > limite:
            break
        estado = rrhh.enviar_ausencia(supa.SERVICIO, f["id"])
        total[estado] = total.get(estado, 0) + 1
    return total


def _matricula(m: str) -> str:
    return " ".join((m or "").upper().replace("-", " ").split())


def _paso_vehiculos(limite: float) -> dict:
    flota = [v for v in _odoo().vehiculos_flota() if _matricula(v["matricula"])]
    if not rrhh.guardar_enlaces():
        return {"en_odoo": len(flota), "aviso": "Odoo en modo simulado: no se importa ningún camión."}
    filas = [{"matricula": _matricula(v["matricula"]), "modelo": v.get("modelo"), "odoo_id": v["id"]} for v in flota]
    if filas:
        supa.insertar(supa.SERVICIO, "vehiculos", filas, conflicto="matricula")
    return {"en_odoo": len(flota), "importados_o_actualizados": len(filas)}


PASOS = {"empleados": _paso_empleados, "fichajes": _paso_fichajes, "ausencias": _paso_ausencias, "vehiculos": _paso_vehiculos}


def procesar(origen: str) -> dict:
    if not supa.clave_servicio():
        raise AppError("Falta configurar la clave de servidor de Supabase (SUPABASE_SECRET_KEY).", 503, "sin_clave_servidor")
    inicio = datetime.now(timezone.utc)
    limite = time.monotonic() + TIEMPO_MAX
    odoo = _odoo()
    try:
        apps = aplicaciones(odoo)
    except Exception:
        log.exception("No se pudo consultar Odoo")
        apps = {m["id"]: None for m in MAPAS}
    resultado: dict[str, dict] = {}
    for m in MAPAS:   # en orden: primero se enlazan las fichas, luego se envía
        if apps[m["id"]] is False:
            resultado[m["id"]] = {"estado": "sin_app", "detalle": f"En Odoo no está instalada la aplicación «{m['nombre_app']}»."}
            continue
        if time.monotonic() > limite:
            resultado[m["id"]] = {"estado": "pendiente", "detalle": "No ha dado tiempo: sigue en la próxima pasada."}
            continue
        try:
            resultado[m["id"]] = {"estado": "ok", **PASOS[m["id"]](limite)}
        except Exception as e:
            log.exception("Sincronización %s", m["id"])
            resultado[m["id"]] = {"estado": "error", "detalle": e.message if isinstance(e, AppError) else "Odoo no ha respondido."}
    registro = {"inicio": inicio.isoformat(), "fin": datetime.now(timezone.utc).isoformat(), "origen": origen,
                "resultado": resultado, "modo": "simulado" if rrhh.rrhh_dry_run() else "real"}
    try:
        supa.insertar(supa.SERVICIO, "odoo_sincronizacion", registro)
    except AppError:
        log.warning("No se pudo guardar el registro de la sincronización")
    return registro


# ------------------------------------------------------------------ rutas

def cron_o_admin(authorization: str = Header("")) -> str:
    """El cron de Vercel manda «Bearer CRON_SECRET». Si no es el cron, hace falta el permiso «admin.sincronizacion»."""
    secreto = (os.environ.get("CRON_SECRET") or "").strip()
    if secreto and hmac.compare_digest(authorization.encode(), f"Bearer {secreto}".encode()):
        return "automatica"
    usuario: Usuario = con_permiso(authorization)
    return f"manual: {usuario.nombre}"[:80]


cron_o_admin.permiso = "admin.sincronizacion"


@router.api_route("/procesar", methods=["GET", "POST"])
def lanzar(origen: str = Depends(cron_o_admin)):
    return procesar(origen)


@router.get("/estado")
def estado(u: Usuario = Depends(con_permiso)):
    """Para la pantalla «Sincronización»: qué va a cada sitio, qué está instalado, qué falta y la última pasada."""
    if not supa.clave_servicio():
        raise AppError("Falta configurar la clave de servidor de Supabase (SUPABASE_SECRET_KEY).", 503, "sin_clave_servidor")
    try:
        apps = aplicaciones(_odoo())
    except Exception:
        apps = {m["id"]: None for m in MAPAS}
    campos = "id,usuario_id,odoo_estado,odoo_error"
    fichajes = supa.leer(supa.SERVICIO, "fichajes", {"odoo_estado": PENDIENTES, "select": campos, "order": "momento.desc", "limit": "500"})
    ausencias = supa.leer(supa.SERVICIO, "ausencias", {"estado": "eq.aprobada", "odoo_estado": PENDIENTES, "select": campos, "limit": "500"})
    sin_ficha = supa.leer(supa.SERVICIO, "usuarios", {"activo": "eq.true", "odoo_employee_id": "is.null", "select": "id,nombre,codigo"})
    ultima = supa.leer(supa.SERVICIO, "odoo_sincronizacion", {"select": "inicio,origen,modo,resultado", "order": "inicio.desc", "limit": "1"})

    def cuenta(filas):
        c: dict[str, int] = {}
        for f in filas:
            c[f["odoo_estado"]] = c.get(f["odoo_estado"], 0) + 1
        return c

    errores = [{"tipo": "Fichaje", **f} for f in fichajes if f["odoo_error"]][:20] + \
              [{"tipo": "Ausencia", **f} for f in ausencias if f["odoo_error"]][:20]
    ids = sorted({e["usuario_id"] for e in errores})
    nombres = {p["id"]: p.get("nombre") or p.get("codigo") or "—" for p in (supa.leer(
        supa.SERVICIO, "usuarios", {"id": f"in.({','.join(ids)})", "select": "id,nombre,codigo"}) if ids else [])}
    for e in errores:
        e["persona"] = nombres.get(e["usuario_id"], "—")
    return {
        "modo_odoo": "simulado" if not rrhh.guardar_enlaces() else "real",
        "envio": "simulado" if rrhh.rrhh_dry_run() else "real",
        "automatica": bool((os.environ.get("CRON_SECRET") or "").strip()),
        "mapas": [{**m, "instalada": apps[m["id"]]} for m in MAPAS],
        "pendientes": {"fichajes": cuenta(fichajes), "ausencias": cuenta(ausencias), "sin_ficha": len(sin_ficha)},
        "personas_sin_ficha": sin_ficha[:50],
        "errores": errores,
        "ultima": ultima[0] if ultima else None,
    }
