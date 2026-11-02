"""Datos de Movildata para la pantalla del chófer. Las asignaciones y los fichajes los guarda la web en Supabase."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from . import movildata, supa
from .auth import Usuario, requiere_permiso
from .errors import AppError

router = APIRouter(prefix="/api/chofer", tags=["chofer"])


@router.get("/hoy")
def hoy(u: Usuario = Depends(requiere_permiso("chofer.usar"))):
    if movildata.modo() == "real" and not u.token:
        raise AppError("Tienes que iniciar sesión.", 401, "sin_sesion")
    vehiculos = supa.leer(u.token, "vehiculos", {"activo": "eq.true", "select": "id,matricula"}) if u.token else []
    resultado = {
        "modo": movildata.modo(),
        "simulado": movildata.modo() == "mock",
        "tarjeta": movildata.tarjeta_en_camion(u.id, vehiculos),
        "resumen": movildata.resumen_dia(u.id),
        "vehiculo": None,
        "aviso": None,
    }
    if resultado["simulado"]:
        return resultado
    asignaciones = supa.leer(u.token, "asignaciones", {"usuario_id": f"eq.{u.id}", "fin": "is.null",
                            "select": "vehiculo_id", "order": "inicio.desc", "limit": "1"})
    asignado = next((v for v in vehiculos if asignaciones and v["id"] == asignaciones[0].get("vehiculo_id")), None)
    if not asignado:
        return {**resultado, "aviso": "Confirma tu camión para ver sus datos de Movildata."}
    flota = movildata.resumen_flota()
    mid = movildata.matricula_id(asignado["matricula"])
    vehiculo = next((v for v in flota["vehiculos"] if v["id"] == mid), None)
    aviso = " ".join(flota["avisos"]) or (None if vehiculo else "Tu camión no devuelve datos en Movildata en este momento.")
    # Nunca devolver datos de otros vehículos ni atribuir datos del vehículo al tacógrafo del conductor.
    return {**resultado, "vehiculo": vehiculo, "aviso": aviso}
