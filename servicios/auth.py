"""Identificación del usuario en la API Python con la sesión de la app general (Supabase).

La pantalla manda `Authorization: Bearer <access_token>` (el token de Supabase del usuario que ha iniciado sesión).
Aquí se comprueba en dos pasos, sin claves de administrador:
  1. Supabase confirma que el token es válido (`/auth/v1/user`).
  2. Con ese mismo token se lee su fila de `usuarios` (las reglas RLS solo le dejan ver la suya) y se exige
     que esté activo y tenga el módulo pedido.

Sin Supabase configurado: en modo simulado se entra como «Usuario de prueba»; en modo real la API se niega a
funcionar (falla cerrada, nunca abierta).
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass, field, replace

import httpx
from fastapi import Header

from .config import get_settings
from .errors import AppError

log = logging.getLogger("conductores")

CACHE_SEGUNDOS = 60          # cada token se comprueba como mucho una vez por minuto
_cache: dict[str, tuple[float, "Usuario"]] = {}


@dataclass(frozen=True)
class Usuario:
    id: str
    nombre: str
    modulos: tuple[str, ...]
    token: str = field(default="", repr=False, compare=False)   # para leer/escribir en Supabase CON SUS permisos


USUARIO_PRUEBA = Usuario(id="prueba", nombre="Usuario de prueba", modulos=("deca", "fichaje", "ausencias", "chofer"))


def _supabase() -> tuple[str, str]:
    # Las mismas variables que usa la parte web (NEXT_PUBLIC_*); SUPABASE_URL / SUPABASE_ANON_KEY si se quieren separar.
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip().rstrip("/")
    clave = (os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") or "").strip()
    return url, clave


def supabase_configurado() -> bool:
    url, clave = _supabase()
    return bool(url and clave)


def _cliente_http() -> httpx.Client:
    return httpx.Client(timeout=10)


def _consultar(token: str) -> Usuario:
    url, clave = _supabase()
    cab = {"apikey": clave, "Authorization": f"Bearer {token}"}
    try:
        with _cliente_http() as http:
            r = http.get(f"{url}/auth/v1/user", headers=cab)
            if r.status_code in (401, 403):
                raise AppError("Tu sesión ha caducado. Vuelve a entrar.", 401, "sin_sesion")
            r.raise_for_status()
            uid = r.json().get("id")
            if not uid:
                raise AppError("Tu sesión ha caducado. Vuelve a entrar.", 401, "sin_sesion")
            p = http.get(f"{url}/rest/v1/usuarios", headers=cab,
                         params={"id": f"eq.{uid}", "select": "nombre,activo,modulos"})
            p.raise_for_status()
            filas = p.json()
    except AppError:
        raise
    except Exception:
        log.exception("No se pudo comprobar la sesión con Supabase")
        raise AppError("No se ha podido comprobar tu sesión. Inténtalo de nuevo.", 503, "sin_conexion_auth")
    if not filas or not filas[0].get("activo"):
        raise AppError("Tu usuario no está activo. Avisa a la oficina.", 403, "usuario_inactivo")
    f = filas[0]
    return Usuario(id=uid, nombre=f.get("nombre") or "", modulos=tuple(f.get("modulos") or ()))


def usuario_actual(token: str) -> Usuario:
    clave = hashlib.sha256(token.encode()).hexdigest()   # nunca se guarda el token en claro
    ahora = time.monotonic()
    hit = _cache.get(clave)
    if hit and hit[0] > ahora:
        return hit[1]
    u = _consultar(token)
    if len(_cache) > 500:
        _cache.clear()
    _cache[clave] = (ahora + CACHE_SEGUNDOS, u)
    return u


def requiere_modulo(modulo: str | tuple[str, ...] | None):
    """Dependencia de FastAPI: exige sesión de la app general, usuario activo y acceso al módulo (o a uno de ellos).
    None: cualquier usuario activo; la ruta debe comprobar después qué puede hacer (p. ej. ser responsable)."""
    alternativos = (modulo,) if isinstance(modulo, str) else modulo

    def dependencia(authorization: str = Header("")) -> Usuario:
        if not supabase_configurado():
            if get_settings().mode == "real":
                raise AppError("La app no está configurada. Avisa a la oficina.", 503, "sin_configurar")
            return USUARIO_PRUEBA   # solo en modo simulado
        token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
        if not token:
            raise AppError("Tienes que iniciar sesión.", 401, "sin_sesion")
        u = usuario_actual(token)
        if alternativos is not None and not set(alternativos) & set(u.modulos):
            raise AppError("No tienes acceso a esta parte de la app. Avisa a la oficina.", 403, "sin_permiso")
        return replace(u, token=token)

    dependencia.modulo = modulo
    return dependencia
