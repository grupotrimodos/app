"""Datos de Movildata para la pantalla del chófer. Las asignaciones y los fichajes los guarda la web en Supabase."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from . import movildata, supa
from .auth import Usuario, requiere_permiso

router = APIRouter(prefix="/api/chofer", tags=["chofer"])


@router.get("/hoy")
def hoy(u: Usuario = Depends(requiere_permiso("chofer.usar"))):
    vehiculos = supa.leer(u.token, "vehiculos", {"activo": "eq.true", "select": "id,matricula"}) if u.token else []
    return {
        "modo": movildata.modo(),
        "simulado": movildata.modo() == "mock",
        "tarjeta": movildata.tarjeta_en_camion(u.id, vehiculos),
        "resumen": movildata.resumen_dia(u.id),
    }
