"""Lectura y escritura en Supabase desde la API Python.

Normalmente SIEMPRE con el token del usuario: se aplican sus permisos (RLS) y la API solo puede hacer lo que el propio
usuario podría hacer.

Excepción: el proceso de sincronización con Odoo (servicios/sincronizacion.py), lanzado por el cron de Vercel o por
alguien con el permiso «admin.sincronizacion», usa `SERVICIO` (la clave secreta, SUPABASE_SECRET_KEY) para enviar lo
pendiente de todas las personas. La clave secreta va SOLO en la cabecera `apikey` y nunca sale del servidor.
"""
from __future__ import annotations

import os

import httpx

from . import auth
from .errors import AppError


class _Servicio:
    """Marca para trabajar con la clave secreta. Es un objeto, no un texto: un token que llegue de fuera nunca puede serlo."""

    def __repr__(self) -> str:
        return "SERVICIO"


SERVICIO = _Servicio()


def clave_servicio() -> str:
    return (os.environ.get("SUPABASE_SECRET_KEY") or "").strip()


def _cliente() -> httpx.Client:
    return httpx.Client(timeout=10)


def _cabeceras(token) -> dict:
    if token is SERVICIO:
        clave = clave_servicio()
        if not clave:
            raise AppError("Falta configurar la clave de servidor de Supabase (SUPABASE_SECRET_KEY).", 503, "sin_clave_servidor")
        return {"apikey": clave, "Content-Type": "application/json"}
    if not isinstance(token, str) or not token:
        raise AppError("Tienes que iniciar sesión.", 401, "sin_sesion")
    _, clave = auth._supabase()
    return {"apikey": clave, "Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _url(tabla: str) -> str:
    url, _ = auth._supabase()
    return f"{url}/rest/v1/{tabla}"


def leer(token, tabla: str, params: dict) -> list[dict]:
    try:
        with _cliente() as http:
            r = http.get(_url(tabla), headers=_cabeceras(token), params=params)
            r.raise_for_status()
            return r.json()
    except httpx.HTTPError:
        raise AppError("No se han podido leer los datos. Inténtalo de nuevo.", 503, "sin_conexion_datos")


def actualizar(token, tabla: str, filtro: dict, datos: dict) -> int:
    """Devuelve cuántas filas ha cambiado (las reglas RLS pueden dejarlo en 0 sin dar error)."""
    try:
        with _cliente() as http:
            r = http.patch(_url(tabla), headers={**_cabeceras(token), "Prefer": "return=representation"},
                           params={**filtro, "select": "id"}, json=datos)
            r.raise_for_status()
            return len(r.json() or [])
    except (httpx.HTTPError, ValueError):
        raise AppError("No se han podido guardar los datos. Inténtalo de nuevo.", 503, "sin_conexion_datos")


def insertar(token, tabla: str, filas: list[dict] | dict, conflicto: str | None = None) -> None:
    """Alta de filas. Con `conflicto` (columna única) actualiza la fila que ya exista."""
    params = {"on_conflict": conflicto} if conflicto else {}
    prefer = "return=minimal" + (",resolution=merge-duplicates" if conflicto else "")
    try:
        with _cliente() as http:
            r = http.post(_url(tabla), headers={**_cabeceras(token), "Prefer": prefer}, params=params, json=filas)
            r.raise_for_status()
    except httpx.HTTPError:
        raise AppError("No se han podido guardar los datos. Inténtalo de nuevo.", 503, "sin_conexion_datos")
