"""Consulta global de flota; permiso explícito, sin escrituras en Movildata ni Odoo."""
from datetime import date

from fastapi import APIRouter, Depends, Query

from . import movildata
from .auth import Usuario, requiere_permiso
from .errors import AppError

router = APIRouter(prefix="/api/flota", tags=["flota"])


def _sesion_real(u: Usuario):
    # El acceso local de prueba de DECA nunca permite leer una clave real de flota.
    if not u.token:
        raise AppError("Tienes que iniciar sesión.", 401, "sin_sesion")


@router.get("/resumen")
def resumen(u: Usuario = Depends(requiere_permiso("flota.ver"))):
    _sesion_real(u)
    return movildata.resumen_flota()


@router.get("/vehiculos/{matricula}/recorrido")
def recorrido(matricula: str, fecha: date = Query(...), u: Usuario = Depends(requiere_permiso("flota.ver"))):
    _sesion_real(u)
    try:
        return movildata.recorrido(matricula, fecha)
    except ValueError as e:
        raise AppError(str(e), 400, "fecha_invalida") from None
    except LookupError as e:
        raise AppError(str(e), 404, "vehiculo_no_disponible") from None
    except movildata.MovildataError as e:
        raise AppError(str(e), 503, "movildata_no_disponible") from None
