"""Lecturas de Movildata, exclusivamente en servidor.

Contrato oficial: https://mapi.movildata.com/Help. La clave viaja como parámetro,
como exige el proveedor; nunca se devuelve la URL ni la respuesta de un error.
El permiso global ``flota.ver`` protege las lecturas de flota en flota.py.
"""
from __future__ import annotations

import copy
import hashlib
import math
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time as hora, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

MADRID = ZoneInfo("Europe/Madrid")
BASE_URL = "https://mapi.movildata.com"
RUTAS = frozenset({"Users/GetVehiculos", "Users/GetLastLocations", "InfoEco/GetLastConsumptions",
                   "Users/GetDataBetweenDates", "Users/GetGPSData"})
CACHE_SEGUNDOS = 60
_cache: dict[tuple, tuple[float, object]] = {}
_cache_lock = threading.Lock()


class MovildataError(Exception):
    """Error seguro para mostrar; no contiene claves, URLs ni respuestas del proveedor."""


def _clave() -> str:
    return (os.environ.get("MOVILDATA_API_KEY") or "").strip()


def modo() -> str:
    configurado = (os.environ.get("MOVILDATA_MODE") or "").strip().lower()
    if configurado == "mock":
        return "mock"
    return "real" if configurado or _clave() else "mock"


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def _cliente() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(7, connect=3), follow_redirects=False)


def _consultar(ruta: str, params: dict | None = None):
    if ruta not in RUTAS:
        raise ValueError("Consulta de Movildata no permitida")
    clave = _clave()
    if not clave:
        raise MovildataError("Falta configurar la conexión con Movildata.")
    parametros = dict(params or {})
    cache_key = (hashlib.sha256(clave.encode()).hexdigest(), ruta, tuple(sorted(parametros.items())))
    with _cache_lock:
        hit = _cache.get(cache_key)
        if hit and hit[0] > time.monotonic():
            return copy.deepcopy(hit[1])
    try:
        with _cliente() as http:
            # No seguir redirecciones: la clave solo se entrega al dominio oficial.
            r = http.get(f"{BASE_URL}/{ruta}", params={**parametros, "apikey": clave},
                         headers={"Accept": "application/json"})
            if r.status_code in (401, 403):
                raise MovildataError("Movildata no permite esta consulta. Revisa la clave y los servicios contratados.")
            if r.status_code == 429:
                raise MovildataError("Movildata ha limitado las consultas. Vuelve a intentarlo en un minuto.")
            if not 200 <= r.status_code < 300:
                raise MovildataError("Movildata no ha podido responder a esta consulta.")
            datos = r.json()
            if not isinstance(datos, (list, dict)):
                raise MovildataError("Movildata ha enviado una respuesta que no se puede leer.")
    except (httpx.HTTPError, ValueError):
        raise MovildataError("No se ha podido conectar con Movildata. Vuelve a intentarlo.") from None
    with _cache_lock:
        if len(_cache) >= 256:
            _cache.clear()
        _cache[cache_key] = (time.monotonic() + CACHE_SEGUNDOS, datos)
    return copy.deepcopy(datos)


def _lista(datos, *, objeto: bool = False) -> list[dict]:
    # GetLastConsumptions documenta un objeto; algunas cuentas devuelven una lista.
    if objeto and isinstance(datos, dict) and ("Imei" in datos or "Matricula" in datos):
        return [datos]
    if not isinstance(datos, list) or any(not isinstance(f, dict) for f in datos):
        raise MovildataError("Movildata ha enviado una respuesta que no se puede leer.")
    return datos


def _numero(valor, minimo: float = 0, maximo: float | None = None) -> float | None:
    if valor is None or isinstance(valor, bool) or isinstance(valor, (list, dict)):
        return None
    try:
        n = float(str(valor).strip().replace(",", "."))
    except (ValueError, TypeError):
        return None
    return n if math.isfinite(n) and n >= minimo and (maximo is None or n <= maximo) else None


def _booleano(valor) -> bool | None:
    if isinstance(valor, bool):
        return valor
    if str(valor).strip().lower() in ("1", "true"):
        return True
    if str(valor).strip().lower() in ("0", "false"):
        return False
    return None


def _fecha(valor) -> str | None:
    if not isinstance(valor, str) or not valor.strip():
        return None
    try:
        d = datetime.fromisoformat(valor.strip().replace("Z", "+00:00"))
        # Los ejemplos del proveedor incluyen offset. Sin él se usa su zona española.
        if d.tzinfo is None:
            d = d.replace(tzinfo=MADRID)
        return d.astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


def _posicion(valor) -> tuple[float | None, float | None]:
    if not isinstance(valor, str):
        return None, None
    partes = valor.strip().split(",")
    if len(partes) != 2:
        return None, None
    lat = _numero(partes[0], -90, 90)
    lon = _numero(partes[1], -180, 180)
    if lat is None or lon is None or (lat == 0 and lon == 0):
        return None, None
    return lat, lon


def matricula_id(valor) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(valor or "").upper())


def _texto(valor) -> str | None:
    return valor.strip()[:200] if isinstance(valor, str) and valor.strip() else None


def _inventario() -> list[dict]:
    filas = _lista(_consultar("Users/GetVehiculos"))
    vistos = set()
    resultado = []
    for fila in filas:
        mat = _texto(fila.get("Matricula"))
        mid = matricula_id(mat)
        if not mid or mid in vistos:
            continue
        vistos.add(mid)
        resultado.append({**fila, "_id": mid, "Matricula": mat})
    return sorted(resultado, key=lambda f: f["_id"])


def _ultima_por(filas: list[dict], identificador: str, fecha: str) -> dict[str, dict]:
    resultado = {}
    for fila in filas:
        clave = str(fila.get(identificador) or "")
        if not clave:
            continue
        previa = resultado.get(clave)
        if previa is None or (_fecha(fila.get(fecha)) or "") > (_fecha(previa.get(fecha)) or ""):
            resultado[clave] = fila
    return resultado


def _rango(dia: date) -> tuple[str, str]:
    inicio = datetime.combine(dia, hora.min, MADRID)
    fin = min(inicio + timedelta(days=1), _ahora().astimezone(MADRID).replace(second=0, microsecond=0))
    return inicio.isoformat(), fin.isoformat()


def _diario(matricula: str, inicio: str, fin: str) -> tuple[dict, list[str]]:
    try:
        datos = _consultar("Users/GetDataBetweenDates", {"matricula": matricula,
                           "fechaInicio": inicio, "fechaFin": fin})
        if not isinstance(datos, dict) or not any(k in datos for k in ("DistanciaRecorrida", "ConsumoTotal", "ConsumoTotalHr")):
            raise MovildataError("No hay un resumen de actividad disponible para este vehículo.")
        return datos, []
    except MovildataError as e:
        return {}, [f"Actividad del día: {e}"]


def _normalizar(fila: dict, posicion: dict, combustible: dict, diario: dict, ahora: datetime, avisos: list[str]) -> dict:
    fecha = _fecha(posicion.get("f"))
    lat, lon = _posicion(posicion.get("loc"))
    velocidad = _numero(posicion.get("veloc"), maximo=250)
    encendido = _booleano(posicion.get("ignic"))
    antiguedad = (ahora - datetime.fromisoformat(fecha)).total_seconds() if fecha else None
    if fecha is None or lat is None or antiguedad is None or antiguedad < -300:
        estado = "sin_datos"
    elif antiguedad > 15 * 60:
        estado = "sin_senal"
    elif velocidad is not None:
        estado = "en_ruta" if velocidad > 3 else "detenido"
    elif encendido is False:
        estado = "detenido"
    else:
        estado = "sin_datos"
    km = _numero(diario.get("DistanciaRecorrida"))
    litros = _numero(diario.get("ConsumoTotalHr"))
    if litros is None:
        litros = _numero(diario.get("ConsumoTotal"))
    return {
        "id": fila["_id"], "matricula": fila["Matricula"], "tipo": _texto(fila.get("TipoVehiculo")),
        "modelo": None, "fecha_posicion": fecha, "latitud": lat, "longitud": lon,
        "velocidad_kmh": velocidad, "motor_encendido": encendido, "estado": estado,
        "combustible_pct": _numero(combustible.get("Tanque"), maximo=100),
        "combustible_litros": _numero(combustible.get("LitrosTanque")),
        "fecha_combustible": _fecha(combustible.get("Fecha")), "km_hoy": km,
        "consumo_hoy_litros": litros,
        "consumo_medio_l_100km": round(litros / km * 100, 1) if litros is not None and km and km > 0 else None,
        "datos_hoy_hasta": _fecha(diario.get("FechaRegistroFin")), "avisos": avisos,
    }


def resumen_flota() -> dict:
    ahora = _ahora()
    respuesta = {"modo": modo(), "simulado": modo() == "mock", "estado": "conectado",
                 "actualizado_en": ahora.isoformat(), "avisos": [], "vehiculos": []}
    if modo() == "mock":
        return {**respuesta, "estado": "simulado", "avisos": ["La conexión con Movildata está en modo de prueba. No se muestran datos reales."]}
    if not _clave():
        return {**respuesta, "estado": "sin_configurar", "avisos": ["Falta configurar la conexión con Movildata."]}
    try:
        inventario = _inventario()
    except MovildataError as e:
        return {**respuesta, "estado": "error", "avisos": [str(e)]}
    if not inventario:
        return {**respuesta, "avisos": ["Movildata no devuelve vehículos para esta cuenta."]}
    inicio, fin = _rango(ahora.astimezone(MADRID).date())
    avisos = []
    # Consultas independientes; un sensor no contratado no oculta el resto de la flota.
    with ThreadPoolExecutor(max_workers=5) as pool:
        futuros = {
            "posiciones": pool.submit(_consultar, "Users/GetLastLocations", {"direcciones": "false"}),
            "combustible": pool.submit(_consultar, "InfoEco/GetLastConsumptions"),
        }
        diarios = {f["_id"]: pool.submit(_diario, f["Matricula"], inicio, fin) for f in inventario}
        colecciones = {}
        for nombre, futuro in futuros.items():
            try:
                colecciones[nombre] = _lista(futuro.result(), objeto=nombre == "combustible")
            except MovildataError as e:
                colecciones[nombre] = []
                avisos.append(f"{'Posiciones' if nombre == 'posiciones' else 'Combustible'}: {e}")
        posiciones = _ultima_por(colecciones["posiciones"], "idv", "f")
        combustible = _ultima_por(colecciones["combustible"], "Imei", "Fecha")
        combustible_mat = {matricula_id(f.get("Matricula")): f for f in colecciones["combustible"]}
        vehiculos = []
        for fila in inventario:
            diario, avisos_dia = diarios[fila["_id"]].result()
            imei = str(fila.get("Imei") or "")
            vehiculos.append(_normalizar(fila, posiciones.get(imei, {}),
                             combustible.get(imei, combustible_mat.get(fila["_id"], {})),
                             diario, ahora, avisos_dia))
    parcial = bool(avisos or any(v["avisos"] for v in vehiculos))
    return {**respuesta, "estado": "parcial" if parcial else "conectado", "avisos": avisos, "vehiculos": vehiculos}


def recorrido(matricula: str, dia: date) -> dict:
    hoy = _ahora().astimezone(MADRID).date()
    if dia > hoy or dia < hoy - timedelta(days=30):
        raise ValueError("Elige un día de los últimos 31 días.")
    mid = matricula_id(matricula)
    if not mid or mid != matricula:
        raise ValueError("La matrícula no es válida.")
    if modo() == "mock":
        raise LookupError("No hay recorridos reales en el modo de prueba.")
    inventario = _inventario()
    vehiculo = next((v for v in inventario if v["_id"] == mid), None)
    if vehiculo is None:
        raise LookupError("Este vehículo no está disponible en Movildata.")
    inicio, fin = _rango(dia)
    filas = _lista(_consultar("Users/GetGPSData", {"matricula": vehiculo["Matricula"], "desde": inicio, "hasta": fin}))
    puntos = []
    for f in filas:
        # El proveedor podría devolver datos adicionales: nunca mezclar otros vehículos.
        if f.get("Matricula") and matricula_id(f["Matricula"]) != mid:
            continue
        fecha = _fecha(f.get("Fecha"))
        lat, lon = _posicion(f.get("Loc"))
        if fecha is None or lat is None or datetime.fromisoformat(fecha).astimezone(MADRID).date() != dia:
            continue
        puntos.append({"fecha": fecha, "latitud": lat, "longitud": lon,
                       "velocidad_kmh": _numero(f.get("Veloc"), maximo=250),
                       "motor_encendido": _booleano(f.get("Ignic"))})
    puntos.sort(key=lambda p: p["fecha"])
    total = len(puntos)
    if total > 1000:
        puntos = [puntos[round(i * (total - 1) / 999)] for i in range(1000)]
    return {"matricula": vehiculo["Matricula"], "fecha": dia.isoformat(), "simulado": False,
            "puntos": puntos, "puntos_totales": total, "simplificado": total > 1000,
            "avisos": [] if puntos else ["Movildata no devuelve posiciones para este vehículo en el día elegido."]}


def tarjeta_en_camion(usuario_id: str, vehiculos: list[dict]) -> dict | None:
    """En real no se infiere identidad del conductor a partir de una matrícula."""
    if modo() != "mock" or not vehiculos:
        return None
    n = int(hashlib.sha256(usuario_id.encode()).hexdigest(), 16)
    v = sorted(vehiculos, key=lambda x: x["id"])[n % len(vehiculos)]
    return {"vehiculo_id": v["id"], "matricula": v["matricula"], "desde": "06:42"}


def resumen_dia(usuario_id: str) -> dict | None:
    """Demostración antigua de Mi camión; jamás se utiliza para datos reales."""
    if modo() != "mock":
        return None
    ahora = datetime.now(MADRID)
    horas = max(0.0, min(9.0, ahora.hour + ahora.minute / 60 - 6.7))
    conduccion = round(horas * 0.78, 2)
    seguida = round(conduccion % 4.5, 2)
    return {"conduccion_horas": conduccion, "km": int(conduccion * 71),
            "pausa_en_horas": round(max(0.0, 4.5 - seguida), 2), "limite_diario_horas": 9}
