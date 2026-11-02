"""Lectura y escritura en Supabase desde la API Python, SIEMPRE con el token del usuario: se aplican sus permisos (RLS).

Nunca se usa la clave secreta aquí: la API Python solo puede hacer lo que el propio usuario podría hacer.
"""
from __future__ import annotations

import httpx

from . import auth
from .errors import AppError


def _cliente() -> httpx.Client:
    return httpx.Client(timeout=10)


def _cabeceras(token: str) -> dict:
    _, clave = auth._supabase()
    return {"apikey": clave, "Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _url(tabla: str) -> str:
    url, _ = auth._supabase()
    return f"{url}/rest/v1/{tabla}"


def leer(token: str, tabla: str, params: dict) -> list[dict]:
    try:
        with _cliente() as http:
            r = http.get(_url(tabla), headers=_cabeceras(token), params=params)
            r.raise_for_status()
            return r.json()
    except httpx.HTTPError:
        raise AppError("No se han podido leer los datos. Inténtalo de nuevo.", 503, "sin_conexion_datos")


def actualizar(token: str, tabla: str, filtro: dict, datos: dict) -> None:
    try:
        with _cliente() as http:
            r = http.patch(_url(tabla), headers={**_cabeceras(token), "Prefer": "return=minimal"}, params=filtro, json=datos)
            r.raise_for_status()
    except httpx.HTTPError:
        raise AppError("No se han podido guardar los datos. Inténtalo de nuevo.", 503, "sin_conexion_datos")
