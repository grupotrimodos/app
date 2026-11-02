"""Fichaje y ausencias → Odoo (hr.attendance, hr.leave).

La fuente de verdad es Supabase (registro de jornada). Aquí solo se ENVÍA a Odoo lo pendiente y se anota el resultado
en cada fila (enviado, simulado, error, sin_empleado). Si Odoo no responde, el fichaje ya está guardado y se reintenta
(al momento, al volver a fichar o en la sincronización automática de servicios/sincronizacion.py).
Correspondencia con Odoo: entrada/reanudar abren una asistencia; pausa/salida cierran la que esté abierta.

Nadie tiene que decir «a dónde» va cada dato: la ficha de empleado se encuentra sola (correo de trabajo o código de
credencial) y el tipo de ausencia de Odoo se elige por su nombre (se puede forzar con ODOO_TIPOS_AUSENCIA).
"""
from __future__ import annotations

import json
import logging
import os
import unicodedata
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import supa
from .auth import Usuario, requiere_permiso
from .config import get_settings
from .errors import AppError

log = logging.getLogger("conductores")
router = APIRouter(prefix="/api/rrhh", tags=["rrhh"])
con_fichaje = requiere_permiso(("fichaje.fichar", "chofer.usar", "fichaje.corregir"))
con_ausencias = requiere_permiso(("ausencias.pedir", "ausencias.aprobar"))
DOMINIO_PIN = "@pin.grupotrimodos.com"   # correo interno de quien entra con código + PIN (no es un correo real)


def rrhh_dry_run() -> bool:
    """Interruptor PROPIO del envío de fichajes y ausencias a Odoo (independiente del DRY_RUN de DECA). Por defecto, sí."""
    return (os.environ.get("RRHH_DRY_RUN") or "true").strip().lower() not in ("0", "false", "no")


_odoo_factory = None   # lo fija main.py (mismo Odoo, real o simulado, que DECA)


def _odoo():
    return _odoo_factory()


def guardar_enlaces() -> bool:
    """Lo leído de Odoo (fichas de empleado, flota) solo se guarda en Supabase con el Odoo REAL: con el simulado se
    llenaría la base de datos de empleados y camiones de prueba."""
    return get_settings().mode == "real"


def _utc_odoo(momento: str) -> str:
    """ISO de Supabase → «AAAA-MM-DD HH:MM:SS» en UTC, como lo espera Odoo."""
    dt = datetime.fromisoformat(momento.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _marcar(token, tabla: str, fila_id: int, estado: str, error: str | None = None) -> None:
    supa.actualizar(token, tabla, {"id": f"eq.{fila_id}"}, {"odoo_estado": estado, "odoo_error": error})


# ------------------------------------------------------------------ ficha de empleado (automática)

def empleado(token, usuario_id: str) -> tuple[int | None, str | None]:
    """Id de empleado de Odoo de esa persona y, si no se encuentra, el motivo (para que la oficina sepa qué arreglar).
    Si no está guardado, se busca en Odoo por su correo de trabajo (Microsoft) o por su código (credencial «barcode»)."""
    filas = supa.leer(token, "usuarios", {"id": f"eq.{usuario_id}", "select": "odoo_employee_id,email,codigo"})
    if not filas:
        raise AppError("No puedes gestionar a ese usuario.", 403, "sin_permiso")
    u = filas[0]
    if u.get("odoo_employee_id"):
        return u["odoo_employee_id"], None
    correo = (u.get("email") or "").strip()
    if correo.lower().endswith(DOMINIO_PIN):
        correo = ""
    codigo = (u.get("codigo") or "").strip()
    try:
        hay = _odoo().buscar_empleado(correo=correo or None, credencial=None if correo else (codigo or None))
    except Exception as e:
        log.warning("No se pudo buscar el empleado en Odoo: %s", e)
        return None, "No se ha podido consultar Odoo para encontrar su ficha de empleado"
    donde = f"con el correo {correo}" if correo else f"con el código de credencial {codigo}" if codigo else "(no tiene correo ni código)"
    if len(hay) != 1:
        return None, (f"En Odoo hay varios empleados {donde}: pon el id a mano en Administración" if hay
                      else f"No hay ningún empleado en Odoo {donde}")
    emp = int(hay[0]["id"])
    if token is supa.SERVICIO and guardar_enlaces():   # solo la sincronización lo guarda (un usuario no edita su ficha)
        supa.actualizar(token, "usuarios", {"id": f"eq.{usuario_id}", "odoo_employee_id": "is.null"}, {"odoo_employee_id": emp})
    return emp, None


# ------------------------------------------------------------------ tipo de ausencia (automático)

PALABRAS_AUSENCIA = {   # se busca en el nombre del tipo de Odoo, sin tildes ni mayúsculas
    "vacaciones": ("vacacion", "paid time off", "annual"),
    "medico": ("medic", "enfermedad", "sick", "baja"),
    "asuntos_propios": ("asuntos propios", "asunto propio", "personal"),
    "otro": ("no retribuido", "unpaid", "otro", "otros", "permiso"),
}
_cache_tipos: dict[str, int] = {}


def _sin_tildes(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t.lower()) if unicodedata.category(c) != "Mn")


def tipo_ausencia(tipo: str) -> int | None:
    try:
        forzado = json.loads(os.environ.get("ODOO_TIPOS_AUSENCIA") or "{}").get(tipo)
    except json.JSONDecodeError:
        forzado = None
    if forzado:
        return int(forzado)
    if tipo in _cache_tipos:
        return _cache_tipos[tipo]
    tipos = [(t["id"], _sin_tildes(t["name"] or "")) for t in _odoo().tipos_ausencia()]
    for palabra in PALABRAS_AUSENCIA.get(tipo, ()):
        hay = [i for i, nombre in tipos if palabra in nombre]
        if len(hay) == 1:
            _cache_tipos[tipo] = hay[0]
            return hay[0]
    return None


# ------------------------------------------------------------------ envío (lo usan las rutas y la sincronización)

def enviar_fichajes(token, usuario_id: str) -> dict:
    filas = supa.leer(token, "fichajes", {
        "usuario_id": f"eq.{usuario_id}", "odoo_estado": "in.(pendiente,error,sin_empleado)",
        "select": "id,tipo,momento,origen", "order": "momento.asc,id.asc"})
    if not filas:
        return {"enviados": 0, "errores": 0}
    simulado = rrhh_dry_run()
    emp, motivo = (None, None) if simulado else empleado(token, usuario_id)
    if not simulado and not emp:
        for f in filas:
            _marcar(token, "fichajes", f["id"], "sin_empleado", motivo)
        return {"enviados": 0, "errores": 0, "sin_empleado": len(filas)}

    enviados = errores = 0
    for f in filas:
        if simulado:
            _marcar(token, "fichajes", f["id"], "simulado")
            enviados += 1
            continue
        try:
            odoo = _odoo()
            momento = _utc_odoo(f["momento"])
            abierta = odoo.asistencia_abierta(emp)
            if f["tipo"] in ("entrada", "reanudar"):
                if abierta:
                    raise ValueError(f"En Odoo hay una entrada sin cerrar ({abierta['check_in']} UTC): ciérrala allí y reintenta")
                odoo.abrir_asistencia(emp, momento)
            elif abierta:
                odoo.cerrar_asistencia(abierta["id"], momento)
            else:
                raise ValueError("En Odoo no hay ninguna entrada abierta que cerrar")
            _marcar(token, "fichajes", f["id"], "enviado")
            enviados += 1
        except Exception as e:
            log.warning("Fichaje %s no enviado a Odoo: %s", f["id"], e)
            _marcar(token, "fichajes", f["id"], "error", str(e)[:300] if isinstance(e, ValueError) else "Odoo no ha aceptado el fichaje")
            errores += 1
            if f.get("origen") != "correccion":
                break   # el orden importa: lo siguiente se reintenta cuando se arregle este
            # una corrección con hora pasada que Odoo rechaza se arregla a mano allí; no frena al resto
    return {"enviados": enviados, "errores": errores}


def enviar_ausencia(token, ausencia_id: int) -> str:
    filas = supa.leer(token, "ausencias", {"id": f"eq.{ausencia_id}",
                                           "select": "id,usuario_id,tipo,desde,hasta,motivo,estado,odoo_estado"})
    if not filas:
        raise AppError("No encontramos esa ausencia.", 404, "no_encontrada")
    a = filas[0]
    if a["estado"] != "aprobada":
        return "no_aplica"
    if a["odoo_estado"] not in ("pendiente", "error", "sin_empleado"):
        return a["odoo_estado"]
    if rrhh_dry_run():
        _marcar(token, "ausencias", a["id"], "simulado")
        return "simulado"
    emp, motivo = empleado(token, a["usuario_id"])
    if not emp:
        _marcar(token, "ausencias", a["id"], "sin_empleado", motivo)
        return "sin_empleado"
    try:
        tipo_id = tipo_ausencia(a["tipo"])
        if not tipo_id:
            _marcar(token, "ausencias", a["id"], "error",
                    f"No encuentro en Odoo un tipo de ausencia para «{a['tipo']}»: créalo allí o fíjalo en ODOO_TIPOS_AUSENCIA")
            return "error"
        _odoo().crear_ausencia(emp, tipo_id, a["desde"], a["hasta"], a.get("motivo") or a["tipo"].replace("_", " ").capitalize())
    except Exception as e:
        log.warning("Ausencia %s no enviada a Odoo: %s", a["id"], e)
        _marcar(token, "ausencias", a["id"], "error", "Odoo no ha aceptado la ausencia")
        return "error"
    _marcar(token, "ausencias", a["id"], "enviado")
    return "enviado"


# ------------------------------------------------------------------ rutas (con los permisos del propio usuario)

class SincronizarFichajes(BaseModel):
    usuario_id: str | None = None   # por defecto, uno mismo; quien corrige puede pedir el de alguien de su equipo


@router.post("/fichajes/sincronizar")
def sincronizar_fichajes(body: SincronizarFichajes, u: Usuario = Depends(con_fichaje)):
    if not u.token:   # modo simulado sin Supabase: no hay nada guardado que enviar
        return {"enviados": 0, "errores": 0}
    return enviar_fichajes(u.token, body.usuario_id or u.id)


@router.post("/ausencias/{ausencia_id}/sincronizar")
def sincronizar_ausencia(ausencia_id: int, u: Usuario = Depends(con_ausencias)):
    # Las reglas de la base de datos (RLS) deciden qué ausencias puede ver y marcar: las suyas o las de su equipo.
    if not u.token:
        return {"estado": "no_aplica"}
    return {"estado": enviar_ausencia(u.token, ausencia_id)}
