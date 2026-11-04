"""Cuadro de mando de dirección: totales comerciales de Odoo (CRM, ventas y facturación) de las empresas configuradas.

Solo lectura y solo totales agrupados (read_group de la lista blanca de odoo_client): ni registros sueltos ni datos de
clientes. Exige el permiso «direccion.ver». Si una aplicación no está instalada en Odoo o no responde, esa parte llega
vacía con su aviso y el resto sigue. Se reutiliza 5 minutos para no cargar Odoo en cada visita.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from . import rrhh
from .auth import Usuario, requiere_permiso

log = logging.getLogger("conductores")
router = APIRouter(prefix="/api/odoo", tags=["direccion"])
con_permiso = requiere_permiso("direccion.ver")
DURACION = 300
_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()


def _hoy() -> date:
    return datetime.now(ZoneInfo("Europe/Madrid")).date()


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


def calcular(odoo, hoy: date) -> dict:
    mes = hoy.replace(day=1)
    siguiente = (mes + timedelta(days=32)).replace(day=1)
    anterior = (mes - timedelta(days=1)).replace(day=1)
    # Para comparar con justicia: del 1 del mes anterior al mismo día de ese mes (no el mes entero).
    hasta_anterior = min(anterior + (hoy - mes) + timedelta(days=1), mes)
    try:
        instaladas = odoo.modulos_instalados(["crm", "sale", "account"])
    except Exception:
        instaladas = None
    avisos: list[str] = []
    res: dict = {"modo": "real" if rrhh.odoo_real() else "simulado", "actualizado": datetime.now(timezone.utc).isoformat(),
                 "mes": mes.isoformat(), "hoy": hoy.isoformat(), "crm": None, "ventas": None, "facturacion": None,
                 "empresas": [], "avisos": avisos}

    def instalada(app: str, nombre: str) -> bool:
        if instaladas is None or app in instaladas:
            return True
        avisos.append(f"{nombre}: la aplicación no está instalada en Odoo.")
        return False

    if instalada("crm", "CRM"):
        try:
            etapas = odoo.crm_abiertas_por_etapa()
            ganadas = odoo.crm_ganadas(mes.isoformat())
            nuevas = odoo.crm_nuevas(mes.isoformat())
            res["crm"] = {"abiertas": _cuenta(etapas), "valor": _suma(etapas),
                          "por_etapa": [{"etapa": e["grupo"], "n": e["n"], "importe": round(e["importe"], 2)} for e in etapas],
                          "ganadas_mes": _cuenta(ganadas), "ganado_mes": _suma(ganadas), "nuevas_mes": _cuenta(nuevas)}
        except Exception as e:
            log.warning("Cuadro de mando: CRM no disponible: %s", e)
            avisos.append("CRM: Odoo no ha respondido.")
    ventas_mes = ventas_ant = facturado = cobrar = vencido = []
    if instalada("sale", "Ventas"):
        try:
            ventas_mes = odoo.ventas(mes.isoformat(), siguiente.isoformat())
            ventas_ant = odoo.ventas(anterior.isoformat(), hasta_anterior.isoformat())
            res["ventas"] = {"mes": _suma(ventas_mes), "pedidos_mes": _cuenta(ventas_mes),
                             "mismo_periodo_anterior": _suma(ventas_ant)}
        except Exception as e:
            log.warning("Cuadro de mando: ventas no disponibles: %s", e)
            avisos.append("Ventas: Odoo no ha respondido.")
    if instalada("account", "Facturación"):
        try:
            facturado = odoo.facturado(mes.isoformat(), siguiente.isoformat())
            cobrar = odoo.por_cobrar()
            vencido = odoo.por_cobrar(vencido_antes_de=hoy.isoformat())
            res["facturacion"] = {"mes": _suma(facturado), "facturas_mes": _cuenta(facturado),
                                  "por_cobrar": _suma(cobrar), "vencido": _suma(vencido), "facturas_vencidas": _cuenta(vencido)}
        except Exception as e:
            log.warning("Cuadro de mando: facturación no disponible: %s", e)
            avisos.append("Facturación: Odoo no ha respondido.")
    res["empresas"] = _por_empresa(("ventas", ventas_mes), ("facturado", facturado), ("por_cobrar", cobrar), ("vencido", vencido))
    return res


@router.get("/comercial")
def comercial(u: Usuario = Depends(con_permiso)):
    with _lock:
        hit = _cache.get("comercial")
    if hit and hit[0] > time.monotonic():
        return hit[1]
    res = calcular(rrhh._odoo_factory(), _hoy())
    with _lock:
        _cache["comercial"] = (time.monotonic() + DURACION, res)
    return res
