"""Cuadro de mando de dirección: cifras de Odoo de las empresas configuradas (ODOO_COMPANY_IDS).

- /api/odoo/comercial («direccion.ver»): CRM, ventas y facturación del mes.
- /api/odoo/finanzas («direccion.finanzas»): facturación y ventas de 24 meses, cobros y pagos pendientes por antigüedad y
  pedidos sin facturar.
- /api/odoo/centros («direccion.finanzas»): ingresos, gastos y margen de cada centro según sus cuentas o etiquetas
  analíticas (la correspondencia centro → analítica está en Supabase, tabla centro_analitica).
- /api/odoo/analitica («admin.usuarios»): catálogo de cuentas y etiquetas analíticas para asignarlas a los centros.

Solo lectura y solo totales agrupados (read_group de la lista blanca de odoo_client; search_read solo para el catálogo
analítico): ni escrituras ni listados de facturas. Cada parte se calcula por separado: si una aplicación no está instalada
o Odoo no responde, esa parte llega a null con su aviso y el resto sigue. «Hoy» es el día de Madrid.
Caché en memoria: 5 minutos el comercial y 10 el resto (1 minuto si alguna parte falló, para reintentar pronto).
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query

from . import rrhh, supa
from .auth import Usuario, requiere_permiso
from .config import get_settings
from .errors import AppError

log = logging.getLogger("conductores")
router = APIRouter(prefix="/api/odoo", tags=["direccion"])
con_permiso = requiere_permiso("direccion.ver")
con_finanzas = requiere_permiso("direccion.finanzas")
con_catalogo = requiere_permiso("admin.usuarios")
DURACION = 300              # comercial
DURACION_FINANZAS = 600     # finanzas, centros y catálogo analítico
REINTENTO = 60              # si alguna parte no respondió
NO_RESPONDE = "Odoo no ha respondido."
TRAMOS = ("por_vencer", "1_30", "31_60", "61_90", "mas_90")
PRINCIPALES = 8
EN_PARALELO = 4             # consultas a Odoo a la vez (secciones o centros): menos espera sin cargar Odoo
_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()


def _hoy() -> date:
    return datetime.now(ZoneInfo("Europe/Madrid")).date()


def _r(x: float) -> float:
    return round(float(x) + 0.0, 2)


def _suma(filas: list[dict]) -> float:
    return round(sum(f["importe"] for f in filas), 2)


def _cuenta(filas: list[dict]) -> int:
    return sum(f["n"] for f in filas)


def _por_empresa(*series: tuple[str, list[dict]]) -> list[dict]:
    """Une varias series por empresa en filas {empresa, <serie>: importe}."""
    empresas: dict[str, dict] = {}
    for nombre, filas in series:
        for f in filas:
            empresas.setdefault(f["grupo"], {"empresa": f["grupo"]})[nombre] = round(f["importe"], 2)
    return sorted(empresas.values(), key=lambda e: e["empresa"])


# ------------------------------------------------------------------ fechas y ventanas de comparación

def _mes_mas(d: date, n: int) -> date:
    """Día 1 del mes que está n meses después (o antes, si n < 0) del de d."""
    i = d.year * 12 + d.month - 1 + n
    return date(i // 12, i % 12 + 1, 1)


def _un_anio_antes(d: date) -> date:
    try:
        return d.replace(year=d.year - 1)
    except ValueError:   # 29 de febrero
        return d.replace(year=d.year - 1, day=28)


def ventanas(hoy: date) -> dict[str, tuple[date, date]]:
    """Ventanas [desde, hasta) de comparación. «Mismo día» = del día 1 hasta el mismo día del mes (o del año) de
    referencia, para comparar periodos igual de largos; si ese mes es más corto, hasta su último día."""
    mes = hoy.replace(day=1)
    anterior = _mes_mas(hoy, -1)
    manana = hoy + timedelta(days=1)
    hace_un_anio = _un_anio_antes(hoy)
    return {
        "mes": (mes, manana),
        "mes_anterior_mismo_dia": (anterior, min(anterior + timedelta(days=hoy.day), mes)),
        "mes_anterior": (anterior, mes),
        "mismo_mes_anio_anterior": (hace_un_anio.replace(day=1), hace_un_anio + timedelta(days=1)),
        "anio": (date(hoy.year, 1, 1), manana),
        "anio_anterior_mismo_dia": (date(hoy.year - 1, 1, 1), hace_un_anio + timedelta(days=1)),
    }


def _clave_mes(d: date) -> str:
    return d.strftime("%Y-%m")


# ------------------------------------------------------------------ ejecución de partes independientes

def _base(hoy: date, empresas: list[int] | None) -> dict:
    return {"modo": "real" if rrhh.odoo_real() else "simulado", "actualizado": datetime.now(timezone.utc).isoformat(),
            "hoy": hoy.isoformat(), "empresa": empresas[0] if empresas else None, "avisos": []}


def _instaladas(odoo, apps: list[str]) -> set[str] | None:
    try:
        return odoo.modulos_instalados(apps)
    except Exception:
        return None   # sin poder comprobarlo, se intenta igualmente


def _ejecutar(tareas: list[tuple[str, callable]]) -> dict[str, tuple[bool, object]]:
    """Ejecuta las partes a la vez (como mucho EN_PARALELO) y devuelve {clave: (ok, resultado o excepción)}.
    El cliente de Odoo ya se comparte entre peticiones simultáneas: cada llamada es una petición HTTP independiente."""
    if not tareas:
        return {}
    with ThreadPoolExecutor(max_workers=min(EN_PARALELO, len(tareas))) as pool:
        futuros = {clave: pool.submit(fn) for clave, fn in tareas}
        salida: dict[str, tuple[bool, object]] = {}
        for clave, futuro in futuros.items():
            try:
                salida[clave] = (True, futuro.result())
            except Exception as e:   # una parte que falla no tumba las demás
                log.warning("Cuadro de mando: %s no disponible: %s", clave, e)
                salida[clave] = (False, e)
        return salida


def _cacheado(clave: str, duracion: int, calcular_fn) -> dict:
    with _lock:
        hit = _cache.get(clave)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    res = calcular_fn()
    if any(NO_RESPONDE in a for a in res.get("avisos", [])):
        duracion = min(duracion, REINTENTO)
    with _lock:
        if len(_cache) > 200:
            _cache.clear()
        _cache[clave] = (time.monotonic() + duracion, res)
    return res


def _empresas(empresa: int | None) -> list[int] | None:
    """Parámetro opcional «empresa»: tiene que ser una de las configuradas."""
    if empresa is None:
        return None
    if empresa not in get_settings().company_ids:
        raise AppError("Esa empresa no está entre las configuradas. Elige otra.", 400, "empresa_invalida")
    return [empresa]


# ------------------------------------------------------------------ comercial (/api/odoo/comercial)

def calcular(odoo, hoy: date, empresas: list[int] | None = None) -> dict:
    mes = hoy.replace(day=1)
    siguiente = _mes_mas(hoy, 1)
    anterior, hasta_anterior = ventanas(hoy)["mes_anterior_mismo_dia"]
    instaladas = _instaladas(odoo, ["crm", "sale", "account"])
    res: dict = {**_base(hoy, empresas), "mes": mes.isoformat(), "crm": None, "ventas": None, "facturacion": None, "empresas": []}
    avisos: list[str] = res["avisos"]

    def instalada(app: str, nombre: str) -> bool:
        if instaladas is None or app in instaladas:
            return True
        avisos.append(f"{nombre}: la aplicación no está instalada en Odoo.")
        return False

    if instalada("crm", "CRM"):
        try:
            etapas = odoo.crm_abiertas_por_etapa(empresas=empresas)
            ganadas = odoo.crm_ganadas(mes.isoformat(), empresas=empresas)
            nuevas = odoo.crm_nuevas(mes.isoformat(), empresas=empresas)
            ganadas_ant = odoo.crm_ganadas(anterior.isoformat(), hasta_anterior.isoformat(), empresas=empresas)
            nuevas_ant = odoo.crm_nuevas(anterior.isoformat(), hasta_anterior.isoformat(), empresas=empresas)
            res["crm"] = {"abiertas": _cuenta(etapas), "valor": _suma(etapas),
                          "por_etapa": [{"etapa": e["grupo"], "n": e["n"], "importe": round(e["importe"], 2)} for e in etapas],
                          "ganadas_mes": _cuenta(ganadas), "ganado_mes": _suma(ganadas), "nuevas_mes": _cuenta(nuevas),
                          "ganadas_mes_anterior": _cuenta(ganadas_ant), "ganado_mes_anterior": _suma(ganadas_ant),
                          "nuevas_mes_anterior": _cuenta(nuevas_ant)}
        except Exception as e:
            log.warning("Cuadro de mando: CRM no disponible: %s", e)
            avisos.append(f"CRM: {NO_RESPONDE}")
    ventas_mes = ventas_ant = facturado = cobrar = vencido = []
    if instalada("sale", "Ventas"):
        try:
            ventas_mes = odoo.ventas(mes.isoformat(), siguiente.isoformat(), empresas=empresas)
            ventas_ant = odoo.ventas(anterior.isoformat(), hasta_anterior.isoformat(), empresas=empresas)
            res["ventas"] = {"mes": _suma(ventas_mes), "pedidos_mes": _cuenta(ventas_mes),
                             "mismo_periodo_anterior": _suma(ventas_ant)}
        except Exception as e:
            log.warning("Cuadro de mando: ventas no disponibles: %s", e)
            avisos.append(f"Ventas: {NO_RESPONDE}")
    if instalada("account", "Facturación"):
        try:
            facturado = odoo.facturado(mes.isoformat(), siguiente.isoformat(), empresas=empresas)
            cobrar = odoo.por_cobrar(empresas=empresas)
            vencido = odoo.por_cobrar(vencido_antes_de=hoy.isoformat(), empresas=empresas)
            res["facturacion"] = {"mes": _suma(facturado), "facturas_mes": _cuenta(facturado),
                                  "por_cobrar": _suma(cobrar), "vencido": _suma(vencido), "facturas_vencidas": _cuenta(vencido)}
        except Exception as e:
            log.warning("Cuadro de mando: facturación no disponible: %s", e)
            avisos.append(f"Facturación: {NO_RESPONDE}")
    res["empresas"] = _por_empresa(("ventas", ventas_mes), ("facturado", facturado), ("por_cobrar", cobrar), ("vencido", vencido))
    return res


# ------------------------------------------------------------------ finanzas (/api/odoo/finanzas)

def serie(por_mes, hoy: date, empresas: list[int] | None) -> dict:
    """Serie de 24 meses y comparativas. Dos llamadas: los 24 meses enteros y, en otra, las tres ventanas parciales (mes
    actual, mes anterior y mismo mes del año pasado hasta el mismo día), que caen en meses distintos y llegan una por grupo."""
    v = ventanas(hoy)
    inicio = _mes_mas(hoy, -23)
    filas = por_mes([(inicio, _mes_mas(hoy, 1))], empresas)
    parciales = por_mes([v["mes"], v["mes_anterior_mismo_dia"], v["mismo_mes_anio_anterior"]], empresas)
    por_mes_: dict[str, list] = {}
    for f in filas:
        m = por_mes_.setdefault(f["mes"], [0.0, 0])
        m[0] += f["importe"]
        m[1] += f["n"]
    parcial: dict[str, float] = {}
    for f in parciales:
        parcial[f["mes"]] = parcial.get(f["mes"], 0.0) + f["importe"]
    meses = []
    for i in range(24):
        clave = _clave_mes(_mes_mas(inicio, i))
        importe, n = por_mes_.get(clave, (0.0, 0))
        meses.append({"mes": clave, "importe": _r(importe), "n": int(n)})
    actual = _clave_mes(hoy)
    mes = parcial.get(actual, 0.0)
    mismo_mes_anio_anterior = parcial.get(_clave_mes(v["mismo_mes_anio_anterior"][0]), 0.0)
    # Año en curso = meses ya cerrados de este año + lo que va de mes (igual para el año anterior hasta el mismo día).
    anio = sum(m["importe"] for m in meses if m["mes"][:4] == str(hoy.year) and m["mes"] < actual) + mes
    anio_ant = sum(m["importe"] for m in meses if m["mes"][:4] == str(hoy.year - 1) and m["mes"][5:] < actual[5:])
    return {"meses": meses, "mes": _r(mes),
            "mes_anterior_mismo_dia": _r(parcial.get(_clave_mes(v["mes_anterior_mismo_dia"][0]), 0.0)),
            "mes_anterior": meses[-2]["importe"], "mismo_mes_anio_anterior": _r(mismo_mes_anio_anterior),
            "anio": _r(anio), "anio_anterior_mismo_dia": _r(anio_ant + mismo_mes_anio_anterior)}


def _tramo(dias_vencida: int) -> str:
    if dias_vencida <= 0:
        return "por_vencer"
    if dias_vencida <= 30:
        return "1_30"
    if dias_vencida <= 60:
        return "31_60"
    if dias_vencida <= 90:
        return "61_90"
    return "mas_90"


def pendiente(odoo, tipo: str, hoy: date, empresas: list[int] | None) -> dict:
    """Pendiente de cobro o de pago: total, vencido, lo que vence en 7 y 30 días, antigüedad y principales."""
    venc = odoo.pendiente_por_vencimiento(tipo, hoy, empresas=empresas)
    principales = odoo.principales_pendiente(tipo, hoy, PRINCIPALES, empresas=empresas)
    tramos = {t: [0.0, 0] for t in TRAMOS}
    vence_7 = vence_30 = 0.0
    for f in venc["dias"]:
        dias_vencida = (hoy - date.fromisoformat(f["dia"])).days
        t = tramos[_tramo(dias_vencida)]
        t[0] += f["importe"]
        t[1] += f["n"]
        if -7 <= dias_vencida <= 0:
            vence_7 += f["importe"]
        if -30 <= dias_vencida <= 0:
            vence_30 += f["importe"]
    tramos["mas_90"][0] += venc["antes"]["importe"]
    tramos["mas_90"][1] += venc["antes"]["n"]
    total = sum(t[0] for t in tramos.values())
    vencido = total - tramos["por_vencer"][0]
    return {"total": _r(total), "n": sum(t[1] for t in tramos.values()),
            "vencido": _r(vencido), "n_vencido": sum(t[1] for k, t in tramos.items() if k != "por_vencer"),
            "vence_7": _r(vence_7), "vence_30": _r(vence_30),
            "tramos": [{"tramo": k, "importe": _r(tramos[k][0]), "n": tramos[k][1]} for k in TRAMOS],
            "principales": [{"nombre": p["nombre"], "importe": _r(p["importe"]), "vencido": _r(p["vencido"]), "n": int(p["n"])}
                            for p in principales[:PRINCIPALES]]}


def _sin_facturar(odoo, hoy: date, empresas: list[int] | None) -> dict:
    s = odoo.sin_facturar(hoy - timedelta(days=30), empresas=empresas)
    return {"importe": _r(s["importe"]), "pedidos": int(s["pedidos"]), "antiguos": int(s["antiguos"]),
            "importe_antiguo": _r(s["importe_antiguo"])}


def calcular_finanzas(odoo, hoy: date, empresas: list[int] | None = None) -> dict:
    res: dict = {**_base(hoy, empresas), "empresas": [], "facturacion": None, "ventas": None, "cobros": None, "pagos": None,
                 "sin_facturar": None}
    avisos: list[str] = res["avisos"]
    instaladas = _instaladas(odoo, ["sale", "account"])
    partes = {   # clave -> (aplicación de Odoo, nombre en pantalla, cálculo)
        "facturacion": ("account", "Facturación", lambda: serie(odoo.facturacion_por_mes, hoy, empresas)),
        "ventas": ("sale", "Ventas", lambda: serie(odoo.ventas_por_mes, hoy, empresas)),
        "cobros": ("account", "Cobros", lambda: pendiente(odoo, "cobrar", hoy, empresas)),
        "pagos": ("account", "Pagos", lambda: pendiente(odoo, "pagar", hoy, empresas)),
        "sin_facturar": ("sale", "Pedidos sin facturar", lambda: _sin_facturar(odoo, hoy, empresas)),
    }
    tareas = [("empresas", odoo.empresas_configuradas)]
    for clave, (app, nombre, fn) in partes.items():
        if instaladas is None or app in instaladas:
            tareas.append((clave, fn))
        else:
            avisos.append(f"{nombre}: la aplicación no está instalada en Odoo.")
    hechas = _ejecutar(tareas)
    ok, empresas_odoo = hechas.pop("empresas")
    res["empresas"] = empresas_odoo if ok else [{"id": i, "nombre": f"Empresa {i}"} for i in get_settings().company_ids]
    for clave, (ok, valor) in hechas.items():   # en el orden de `partes`: los avisos siempre salen igual
        if ok:
            res[clave] = valor
        else:
            avisos.append(f"{partes[clave][1]}: {NO_RESPONDE}")
    return res


# ------------------------------------------------------------------ centros (/api/odoo/centros)

def _ventana_analitica(odoo, grupo: str, cuentas: list[int], etiquetas: list[int], hoy: date,
                       empresas: list[int] | None) -> dict:
    """Ingresos o gastos de un centro en las ventanas de comparación. Dos read_group por centro y tipo:
    1) por mes, del 1 de enero del año pasado hasta el mismo día del año pasado y del 1 de enero hasta hoy (el mes en curso
       y el mismo mes del año pasado llegan ya recortados al mismo día) → mes, año y año anterior;
    2) del 1 del mes anterior hasta el mismo día → mes anterior.
    Así son 4 llamadas por centro (ingresos y gastos), con pocas filas cada una, en lugar de agrupar por día (cientos de
    filas) o de una llamada por ventana (8 por centro)."""
    v = ventanas(hoy)
    filas = odoo.analitica_por_mes(grupo, cuentas, etiquetas, [v["anio_anterior_mismo_dia"], v["anio"]], empresas=empresas)
    previo = odoo.analitica_por_mes(grupo, cuentas, etiquetas, [v["mes_anterior_mismo_dia"]], empresas=empresas)
    actual = _clave_mes(hoy)
    return {"mes": _r(sum(f["importe"] for f in filas if f["mes"] == actual)),
            "mes_anterior_mismo_dia": _r(sum(f["importe"] for f in previo)),
            "anio": _r(sum(f["importe"] for f in filas if f["mes"][:4] == str(hoy.year))),
            "anio_anterior_mismo_dia": _r(sum(f["importe"] for f in filas if f["mes"][:4] == str(hoy.year - 1)))}


def calcular_centros(odoo, hoy: date, centros: list[dict], analitica: list[dict], empresas: list[int] | None = None) -> dict:
    """`centros`: [{id, nombre}] activos; `analitica`: filas de centro_analitica [{centro_id, tipo, odoo_id, nombre}]."""
    res: dict = {**_base(hoy, empresas), "centros": []}
    avisos: list[str] = res["avisos"]
    asignado: dict[int, dict[str, set]] = {}
    for a in analitica:
        if a.get("tipo") in ("cuenta", "etiqueta") and a.get("odoo_id") is not None and a.get("centro_id") is not None:
            asignado.setdefault(int(a["centro_id"]), {"cuenta": set(), "etiqueta": set()})[a["tipo"]].add(int(a["odoo_id"]))
    instaladas = _instaladas(odoo, ["account"])
    sin_app = instaladas is not None and "account" not in instaladas
    if sin_app:
        avisos.append("Centros: la aplicación de Contabilidad no está instalada en Odoo.")
    tareas = []
    for c in centros:
        m = asignado.get(int(c["id"]), {"cuenta": set(), "etiqueta": set()})
        cuentas, etiquetas = sorted(m["cuenta"]), sorted(m["etiqueta"])
        fila = {"centro_id": int(c["id"]), "nombre": c.get("nombre") or "", "configurado": bool(cuentas or etiquetas),
                "ingresos": None, "gastos": None, "margen": None}
        res["centros"].append(fila)
        if fila["configurado"] and not sin_app:
            for grupo, clave in (("income", "ingresos"), ("expense", "gastos")):
                tareas.append(((fila["centro_id"], clave),
                               lambda g=grupo, cu=cuentas, et=etiquetas: _ventana_analitica(odoo, g, cu, et, hoy, empresas)))
    hechas = _ejecutar(tareas)
    fallidos = []
    for fila in res["centros"]:
        for clave in ("ingresos", "gastos"):
            ok, valor = hechas.get((fila["centro_id"], clave), (True, None))
            if ok:
                fila[clave] = valor
            elif fila["nombre"] not in fallidos:
                fallidos.append(fila["nombre"])
        if fila["ingresos"] and fila["gastos"]:
            fila["margen"] = {k: _r(fila["ingresos"][k] - fila["gastos"][k]) for k in fila["ingresos"]}
    if fallidos:
        avisos.append(f"Centros ({', '.join(fallidos)}): {NO_RESPONDE}")
    return res


# ------------------------------------------------------------------ catálogo analítico (/api/odoo/analitica)

def calcular_analitica(odoo, hoy: date, empresas: list[int] | None = None) -> dict:
    res: dict = {**_base(hoy, empresas), "cuentas": None, "etiquetas": None}
    nombres = {"cuentas": "Cuentas analíticas", "etiquetas": "Etiquetas analíticas"}
    hechas = _ejecutar([("cuentas", lambda: odoo.cuentas_analiticas(empresas=empresas)),
                        ("etiquetas", lambda: odoo.etiquetas_analiticas(empresas=empresas))])
    for clave, (ok, valor) in hechas.items():
        if ok:
            res[clave] = valor
        else:
            res["avisos"].append(f"{nombres[clave]}: {NO_RESPONDE}")
    return res


# ------------------------------------------------------------------ rutas

@router.get("/comercial")
def comercial(empresa: int | None = Query(None), u: Usuario = Depends(con_permiso)):
    empresas = _empresas(empresa)
    hoy = _hoy()
    return _cacheado(f"comercial:{empresa}:{hoy}", DURACION, lambda: calcular(rrhh._odoo_factory(), hoy, empresas))


@router.get("/finanzas")
def finanzas(empresa: int | None = Query(None), u: Usuario = Depends(con_finanzas)):
    empresas = _empresas(empresa)
    hoy = _hoy()
    return _cacheado(f"finanzas:{empresa}:{hoy}", DURACION_FINANZAS,
                     lambda: calcular_finanzas(rrhh._odoo_factory(), hoy, empresas))


@router.get("/centros")
def centros(empresa: int | None = Query(None), u: Usuario = Depends(con_finanzas)):
    empresas = _empresas(empresa)
    hoy = _hoy()
    if not u.token:   # modo simulado sin Supabase: no hay centros que leer
        return {**_base(hoy, empresas), "centros": [],
                "avisos": ["Sin la base de datos configurada no se pueden leer los centros."]}
    try:   # con el token de quien mira: se aplican sus permisos (RLS)
        lista = supa.leer(u.token, "centros", {"select": "id,nombre", "activo": "eq.true", "order": "nombre"})
        analitica = supa.leer(u.token, "centro_analitica", {"select": "centro_id,tipo,odoo_id,nombre"})
    except AppError as e:
        log.warning("Cuadro de mando: no se pudieron leer los centros o su analítica: %s", e.message)
        return {**_base(hoy, empresas), "centros": [],
                "avisos": ["No se han podido leer los centros ni sus cuentas analíticas. Inténtalo de nuevo."]}
    lista = sorted(({"id": int(c["id"]), "nombre": c.get("nombre") or ""} for c in lista), key=lambda c: (c["nombre"], c["id"]))
    asignacion = sorted((int(a["centro_id"]), str(a.get("tipo")), int(a["odoo_id"])) for a in analitica
                        if a.get("centro_id") is not None and a.get("odoo_id") is not None)
    huella = hashlib.sha256(json.dumps([[(c["id"], c["nombre"]) for c in lista], asignacion]).encode()).hexdigest()[:16]
    return _cacheado(f"centros:{empresa}:{hoy}:{huella}", DURACION_FINANZAS,
                     lambda: calcular_centros(rrhh._odoo_factory(), hoy, lista, analitica, empresas))


@router.get("/analitica")
def analitica(empresa: int | None = Query(None), u: Usuario = Depends(con_catalogo)):
    empresas = _empresas(empresa)
    hoy = _hoy()
    return _cacheado(f"analitica:{empresa}", DURACION_FINANZAS, lambda: calcular_analitica(rrhh._odoo_factory(), hoy, empresas))
