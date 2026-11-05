"""Odoo (AGENTS.md, base 4): leer, cualquier modelo; escribir, solo las dos listas cerradas; borrar, nunca; y ninguna
ruta de la API lee «el modelo que le pidan» (leer no es enseñar).

Si una prueba de aquí falla porque alguien ha añadido una escritura o una vía nueva hacia Odoo, NO se arregla la
prueba: se propone el cambio a Félix explicando qué toca y, solo con su permiso expreso, se amplía la lista de aquí.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

import servicios.argon  # noqa: F401  (añade la carpeta de ARGON al path)
import argon_escritor as ARGON  # noqa: E402
from servicios.config import get_settings
from servicios.odoo_client import EDITABLE_FIELDS, ESCRITURAS, METODOS_LECTURA, REPORT_NAME, OdooClient, permitido

RAIZ = Path(__file__).resolve().parent.parent

# Métodos que solo leen. Cualquier otro método es una escritura.
LECTURA = {"search_read", "read", "read_group", "search", "search_count", "name_search", "fields_get", "check_access_rights"}

# Lista cerrada de servicios/odoo_client.py: fichajes, ausencias, notas y bultos/peso de DECA.
ESCRITURAS_APP = {
    ("tms.package", "write"),          # DECA: bultos, euro palets, mercancía y peso (solo EDITABLE_FIELDS)
    ("project.task", "message_post"),  # DECA: nota en la tarea de la orden
    ("hr.attendance", "create"),       # fichaje: abrir asistencia
    ("hr.attendance", "write"),        # fichaje: cerrar asistencia (check_out)
    ("hr.leave", "create"),            # ausencia aprobada → solicitud en Odoo
}
CAMPOS_DECA = {"goods_id", "number_of_packages", "euro_pallet_qty", "shipping_weight"}
INFORME_DECA = "tms_reporting.tms_transportation_order"

# Lista de ARGON, congelada tal como estaba (solo Odoo de pruebas salvo ARGON_PERMITIR_PRODUCCION=1).
ESCRITURAS_ARGON = {("sale.order", "create"), ("sale.order", "write"), ("sale.order", "action_confirm"), ("tms.equipment", "create")}

# Únicos archivos que pueden hablar con Odoo directamente.
VIAS_A_ODOO = {"servicios/odoo_client.py", "servicios/argon/argon_escritor.py"}
PATRON_ODOO = re.compile(r"execute_kw|/jsonrpc|/xmlrpc|/web/dataset|/report/(pdf|html)|/web/session")


def escrituras(lista) -> set[tuple[str, str]]:
    return {c for c in lista if c[1] not in LECTURA}


def test_la_app_solo_escribe_en_odoo_lo_de_su_lista_cerrada():
    assert set(ESCRITURAS) == ESCRITURAS_APP
    assert all(len(explicacion) > 20 and "vía " in explicacion for explicacion in ESCRITURAS.values())   # qué toca y por dónde


def test_los_metodos_de_lectura_no_esconden_ninguna_escritura():
    assert set(METODOS_LECTURA) == LECTURA


@pytest.mark.parametrize("modelo", ["hr.employee", "fleet.vehicle", "hr.payslip", "account.move.line", "tms.equipment", "stock.quant"])
def test_se_puede_leer_cualquier_modelo_pero_no_escribirlo(modelo):
    assert all(permitido(modelo, m) for m in LECTURA)
    assert not any(permitido(modelo, m) for m in ("create", "write", "unlink", "copy", "action_confirm", "toggle_active"))


def test_argon_solo_escribe_lo_de_su_lista_congelada():
    assert escrituras(ARGON.PERMITIDO) == ESCRITURAS_ARGON


@pytest.mark.parametrize("lista", [set(ESCRITURAS), ARGON.PERMITIDO], ids=["app", "argon"])
def test_nunca_se_borra_en_odoo(lista):
    assert not [c for c in lista if c[1] == "unlink"]


def test_deca_solo_cambia_sus_cuatro_campos():
    assert set(EDITABLE_FIELDS) == CAMPOS_DECA
    c = OdooClient(get_settings())
    for campo in ("state", "name", "partner_id", "carrier_tracking_ref"):
        with pytest.raises(PermissionError):
            c.write_package(1, {campo: "x"})


def test_deca_solo_imprime_su_orden_de_transporte():
    assert REPORT_NAME == INFORME_DECA
    fuente = (RAIZ / "servicios/odoo_client.py").read_text(encoding="utf-8")
    informes = re.findall(r"/report/(?:pdf|html)/([^\"'/]+)/", fuente)
    assert informes and set(informes) == {"{REPORT_NAME}"}


@pytest.mark.parametrize("modelo,metodo", [
    ("res.partner", "write"), ("hr.employee", "write"), ("hr.leave", "write"), ("hr.attendance", "unlink"),
    ("tms.package", "unlink"), ("tms.package", "create"), ("account.move", "create"), ("sale.order", "write"),
])
def test_el_cliente_de_la_app_rechaza_escrituras_fuera_de_lista_sin_llegar_a_odoo(modelo, metodo, monkeypatch):
    c = OdooClient(get_settings())
    monkeypatch.setattr(c, "_rpc", lambda *a, **k: pytest.fail("Ha intentado hablar con Odoo"))
    with pytest.raises(PermissionError):
        c._call(modelo, metodo, [[1], {}])


@pytest.mark.parametrize("modelo,metodo", [
    ("sale.order", "unlink"), ("sale.order.line", "write"), ("res.partner", "create"), ("account.move", "create"),
    ("tms.equipment", "write"),
])
def test_argon_rechaza_escrituras_fuera_de_su_lista_sin_llegar_a_odoo(modelo, metodo):
    o = object.__new__(ARGON.Odoo)   # sin conectarse: la comprobación va antes de cualquier llamada
    o._rpc = lambda *a, **k: pytest.fail("Ha intentado hablar con Odoo")
    o.llamadas, o.empresa = 0, 1
    with pytest.raises(PermissionError):
        o(modelo, metodo, [[1]])


def test_nadie_mas_habla_con_odoo_por_su_cuenta():
    carpetas = ["servicios", "scripts", "api", "src", "public"]
    encontrados = {
        str(p.relative_to(RAIZ)) for d in carpetas for p in (RAIZ / d).rglob("*")
        if p.suffix in {".py", ".ts", ".tsx", ".js"} and "vendor" not in p.parts and "__pycache__" not in p.parts
        and PATRON_ODOO.search(p.read_text(encoding="utf-8", errors="ignore"))
    }
    assert encontrados == VIAS_A_ODOO


def test_ninguna_ruta_lee_el_modelo_que_le_pidan():
    """Leer no es enseñar: cada ruta devuelve lo suyo, con su permiso. Ninguna acepta un modelo, un método, un dominio
    o unos campos de Odoo como parámetro (sería una puerta a nóminas, salarios o contabilidad)."""
    from servicios.main import app
    prohibidos = {"modelo", "model", "metodo", "method", "dominio", "domain", "campos", "fields", "res_model"}
    abiertas = []
    for r in app.routes:
        dep = getattr(r, "dependant", None)
        if dep is None:
            continue
        nombres = {p.name for p in dep.query_params + dep.path_params + dep.body_params}
        if nombres & prohibidos:
            abiertas.append((r.path, sorted(nombres & prohibidos)))
    assert not abiertas
