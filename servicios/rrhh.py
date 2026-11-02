"""Fichaje y ausencias → Odoo (hr.attendance, hr.leave).

La fuente de verdad es Supabase (registro de jornada). Aquí solo se ENVÍA a Odoo lo pendiente y se anota el resultado
en cada fila (enviado, simulado, error, sin_empleado). Si Odoo no responde, el fichaje ya está guardado y se reintenta.
Correspondencia con Odoo: entrada/reanudar abren una asistencia; pausa/salida cierran la que esté abierta.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import supa
from .auth import Usuario, requiere_modulo
from .errors import AppError

log = logging.getLogger("conductores")
router = APIRouter(prefix="/api/rrhh", tags=["rrhh"])
con_fichaje = requiere_modulo(("fichaje", "chofer"))
sesion = requiere_modulo(None)   # ausencias: el interesado (módulo «ausencias») o su responsable; se comprueba en la ruta


def rrhh_dry_run() -> bool:
    """Interruptor PROPIO del envío de fichajes y ausencias a Odoo (independiente del DRY_RUN de DECA). Por defecto, sí."""
    return (os.environ.get("RRHH_DRY_RUN") or "true").strip().lower() not in ("0", "false", "no")

_odoo_factory = None   # lo fija main.py (mismo Odoo, real o simulado, que DECA)


def _odoo():
    return _odoo_factory()


def _utc_odoo(momento: str) -> str:
    """ISO de Supabase → «AAAA-MM-DD HH:MM:SS» en UTC, como lo espera Odoo."""
    dt = datetime.fromisoformat(momento.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _empleado(token: str, usuario_id: str) -> int | None:
    filas = supa.leer(token, "usuarios", {"id": f"eq.{usuario_id}", "select": "odoo_employee_id"})
    if not filas:
        raise AppError("No puedes gestionar a ese usuario.", 403, "sin_permiso")
    return filas[0].get("odoo_employee_id")


def _marcar(token: str, tabla: str, fila_id: int, estado: str, error: str | None = None) -> None:
    supa.actualizar(token, tabla, {"id": f"eq.{fila_id}"}, {"odoo_estado": estado, "odoo_error": error})


class SincronizarFichajes(BaseModel):
    usuario_id: str | None = None   # por defecto, uno mismo; un responsable puede pedir el de alguien de su equipo


@router.post("/fichajes/sincronizar")
def sincronizar_fichajes(body: SincronizarFichajes, u: Usuario = Depends(con_fichaje)):
    if not u.token:   # modo simulado sin Supabase: no hay nada guardado que enviar
        return {"enviados": 0, "errores": 0}
    objetivo = body.usuario_id or u.id
    filas = supa.leer(u.token, "fichajes", {
        "usuario_id": f"eq.{objetivo}", "odoo_estado": "in.(pendiente,error)",
        "select": "id,tipo,momento,origen", "order": "momento.asc,id.asc"})
    if not filas:
        return {"enviados": 0, "errores": 0}
    emp = _empleado(u.token, objetivo)
    if not emp:
        for f in filas:
            _marcar(u.token, "fichajes", f["id"], "sin_empleado", "Falta el id de empleado de Odoo en su ficha")
        return {"enviados": 0, "errores": 0, "sin_empleado": len(filas)}

    simulado = rrhh_dry_run()
    enviados = errores = 0
    for f in filas:
        if simulado:
            _marcar(u.token, "fichajes", f["id"], "simulado")
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
            _marcar(u.token, "fichajes", f["id"], "enviado")
            enviados += 1
        except Exception as e:
            log.warning("Fichaje %s no enviado a Odoo: %s", f["id"], e)
            _marcar(u.token, "fichajes", f["id"], "error", str(e)[:300] if isinstance(e, ValueError) else "Odoo no ha aceptado el fichaje")
            errores += 1
            if f.get("origen") != "correccion":
                break   # el orden importa: lo siguiente se reintenta cuando se arregle este
            # una corrección con hora pasada que Odoo rechaza se arregla a mano allí; no frena al resto
    return {"enviados": enviados, "errores": errores}


def _tipos_ausencia() -> dict:
    try:
        return json.loads(os.environ.get("ODOO_TIPOS_AUSENCIA") or "{}")
    except json.JSONDecodeError:
        return {}


def _es_responsable(u: Usuario) -> bool:
    if supa.leer(u.token, "usuarios", {"id": f"eq.{u.id}", "es_admin": "eq.true", "select": "id"}):
        return True
    return bool(supa.leer(u.token, "usuario_centro_rol", {"usuario_id": f"eq.{u.id}", "rol": "eq.responsable", "select": "centro_id"}))


@router.post("/ausencias/{ausencia_id}/sincronizar")
def sincronizar_ausencia(ausencia_id: int, u: Usuario = Depends(sesion)):
    if not u.token:
        return {"estado": "no_aplica"}
    if "ausencias" not in u.modulos and not _es_responsable(u):
        raise AppError("No tienes acceso a esta parte de la app. Avisa a la oficina.", 403, "sin_permiso")
    filas = supa.leer(u.token, "ausencias", {"id": f"eq.{ausencia_id}",
                                              "select": "id,usuario_id,tipo,desde,hasta,motivo,estado,odoo_estado"})
    if not filas:
        raise AppError("No encontramos esa ausencia.", 404, "no_encontrada")
    a = filas[0]
    if a["estado"] != "aprobada":
        return {"estado": "no_aplica"}
    if a["odoo_estado"] not in ("pendiente", "error"):
        return {"estado": a["odoo_estado"]}
    emp = _empleado(u.token, a["usuario_id"])
    if not emp:
        _marcar(u.token, "ausencias", a["id"], "sin_empleado", "Falta el id de empleado de Odoo en su ficha")
        return {"estado": "sin_empleado"}
    if rrhh_dry_run():
        _marcar(u.token, "ausencias", a["id"], "simulado")
        return {"estado": "simulado"}
    tipo_id = _tipos_ausencia().get(a["tipo"])
    if not tipo_id:
        _marcar(u.token, "ausencias", a["id"], "error", f"Falta configurar en ODOO_TIPOS_AUSENCIA el tipo «{a['tipo']}»")
        return {"estado": "error"}
    try:
        _odoo().crear_ausencia(emp, tipo_id, a["desde"], a["hasta"], a.get("motivo") or a["tipo"].replace("_", " ").capitalize())
    except Exception as e:
        log.warning("Ausencia %s no enviada a Odoo: %s", a["id"], e)
        _marcar(u.token, "ausencias", a["id"], "error", "Odoo no ha aceptado la ausencia")
        return {"estado": "error"}
    _marcar(u.token, "ausencias", a["id"], "enviado")
    return {"estado": "enviado"}
