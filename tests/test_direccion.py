"""Cuadro de mando financiero (Odoo, solo lectura y solo totales): cálculos, dominios v15, permisos y parámetro «empresa»."""
from datetime import date
from types import SimpleNamespace

import httpx
import pytest
from test_rrhh import SupabaseFalso

from servicios import direccion
from servicios.errors import AppError
from servicios.mock_odoo import MockOdoo
from servicios.odoo_client import OdooClient, dominio_analitico, inicio_grupo

HOY = date(2026, 11, 5)
ANA = {"Authorization": "Bearer tok-ana"}
JEFA_H = {"Authorization": "Bearer tok-jefa"}
DIR = {"Authorization": "Bearer tok-dir"}        # solo «direccion.finanzas»
ADMIN = {"Authorization": "Bearer tok-admin"}    # solo «admin.usuarios»


@pytest.fixture(autouse=True)
def _sin_cache():
    direccion._cache.clear()
    yield
    direccion._cache.clear()


@pytest.fixture
def entorno(monkeypatch):
    import servicios.auth as auth
    import servicios.main as main
    import servicios.supa as supa
    sb = SupabaseFalso()
    sb.tokens.update({"tok-dir": "u-dir", "tok-admin": "u-admin"})
    sb.tablas["usuarios"] += [{"id": "u-dir", "nombre": "Dirección", "activo": True, "permisos": ["direccion.finanzas"]},
                              {"id": "u-admin", "nombre": "Admin", "activo": True, "permisos": ["admin.usuarios"]}]
    sb.tablas["centros"] = [{"id": 1, "nombre": "Grao de Castellón", "activo": True},
                            {"id": 2, "nombre": "Sevilla", "activo": True},
                            {"id": 3, "nombre": "Centro cerrado", "activo": False}]
    sb.tablas["centro_analitica"] = [{"centro_id": 1, "tipo": "cuenta", "odoo_id": 101, "nombre": "Grao de Castellón"},
                                     {"centro_id": 1, "tipo": "etiqueta", "odoo_id": 204, "nombre": "Viajes Sevilla"}]
    monkeypatch.setenv("ODOO_MODE", "mock")
    monkeypatch.setenv("ODOO_COMPANY_IDS", "1,7")
    monkeypatch.setenv("SUPABASE_URL", "https://proyecto.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "clave-publica")
    transporte = httpx.MockTransport(sb.handler)
    monkeypatch.setattr(auth, "_cliente_http", lambda: httpx.Client(transport=transporte))
    monkeypatch.setattr(supa, "_cliente", lambda: httpx.Client(transport=transporte))
    odoo = MockOdoo()
    monkeypatch.setattr(main, "_odoo", odoo)
    monkeypatch.setattr(direccion, "_hoy", lambda: HOY)
    auth._cache.clear()
    from fastapi.testclient import TestClient
    yield sb, odoo, TestClient(main.app)
    auth._cache.clear()


# ------------------------------------------------------------------ mes del grupo de read_group (sin leer la etiqueta)

def test_inicio_del_grupo_sale_de_range_o_del_dominio_nunca_de_la_etiqueta():
    # v16+: «__range» (por la especificación del grupo o por el campo)
    assert inicio_grupo({"invoice_date:month": "noviembre 2026",
                         "__range": {"invoice_date:month": {"from": "2026-11-01", "to": "2026-12-01"}}},
                        "invoice_date:month") == date(2026, 11, 1)
    assert inicio_grupo({"__range": {"date": {"from": "2026-02-01", "to": "2026-03-01"}}}, "date:month") == date(2026, 2, 1)
    # v15: solo «__domain»; el «>=» del grupo va primero y nuestras ventanas usan «>», así que no se confunden
    fila = {"invoice_date:month": "octubre 2026", "__count": 3,
            "__domain": ["&", "&", ["invoice_date", ">=", "2026-10-01"], ["invoice_date", "<", "2026-11-01"],
                         "|", "&", ["invoice_date", ">", "2026-10-31"], ["invoice_date", "<", "2026-11-06"],
                         "&", ["invoice_date", ">", "2026-09-30"], ["invoice_date", "<", "2026-10-06"]]}
    assert inicio_grupo(fila, "invoice_date:month") == date(2026, 10, 1)
    assert inicio_grupo({"__domain": [("invoice_date_due", ">=", "2026-11-05"), ("invoice_date_due", "<", "2026-11-06")]},
                        "invoice_date_due:day") == date(2026, 11, 5)
    # fecha y hora en UTC con zona de Madrid: el 1 de noviembre empieza el 31 de octubre a las 23:00 UTC
    assert inicio_grupo({"__domain": [["date_order", ">=", "2026-10-31 23:00:00"], ["date_order", "<", "2026-11-30 23:00:00"]]},
                        "date_order:month") == date(2026, 11, 1)
    assert inicio_grupo({"__domain": [["date_order", ">=", "2026-11-01 00:00:00"]]}, "date_order:month") == date(2026, 11, 1)
    # solo etiqueta (o grupo «sin fecha»): no se adivina
    assert inicio_grupo({"invoice_date:month": "noviembre 2026"}, "invoice_date:month") is None
    assert inicio_grupo({"invoice_date:month": False, "__domain": [["invoice_date", "=", False]]}, "invoice_date:month") is None


def test_ventanas_de_comparacion():
    v = direccion.ventanas(HOY)
    assert v["mes"] == (date(2026, 11, 1), date(2026, 11, 6))
    assert v["mes_anterior_mismo_dia"] == (date(2026, 10, 1), date(2026, 10, 6))
    assert v["mes_anterior"] == (date(2026, 10, 1), date(2026, 11, 1))
    assert v["mismo_mes_anio_anterior"] == (date(2025, 11, 1), date(2025, 11, 6))
    assert v["anio"] == (date(2026, 1, 1), date(2026, 11, 6))
    assert v["anio_anterior_mismo_dia"] == (date(2025, 1, 1), date(2025, 11, 6))
    assert direccion.ventanas(date(2026, 3, 31))["mes_anterior_mismo_dia"] == (date(2026, 2, 1), date(2026, 3, 1))  # febrero entero
    assert direccion.ventanas(date(2028, 2, 29))["mismo_mes_anio_anterior"] == (date(2027, 2, 1), date(2027, 3, 1))
    assert direccion.ventanas(date(2027, 1, 15))["mes_anterior"] == (date(2026, 12, 1), date(2027, 1, 1))


# ------------------------------------------------------------------ finanzas con el Odoo simulado y fecha fija

def test_series_de_24_meses_y_sus_comparativas():
    odoo = MockOdoo()
    d = direccion.calcular_finanzas(odoo, HOY)
    assert d["modo"] in ("real", "simulado") and d["hoy"] == "2026-11-05" and d["empresa"] is None and d["avisos"] == []
    assert d["empresas"] == [{"id": 1, "nombre": "STINSA"}, {"id": 7, "nombre": "TRANSARGI S.L.U"}]
    for clave in ("facturacion", "ventas"):
        s = d[clave]
        meses = [m["mes"] for m in s["meses"]]
        assert len(meses) == 24 and meses[0] == "2024-12" and meses[-1] == "2026-11" and meses == sorted(meses)
        assert all(m["importe"] > 0 and m["n"] > 0 for m in s["meses"])
        assert s["mes_anterior"] == s["meses"][-2]["importe"]
        assert 0 < s["mes"] < s["meses"][-1]["importe"]                       # 5 días frente al mes entero
        assert 0 < s["mes_anterior_mismo_dia"] < s["mes_anterior"]
        este_anio = sum(m["importe"] for m in s["meses"] if "2026-01" <= m["mes"] <= "2026-10")
        anio_pasado = sum(m["importe"] for m in s["meses"] if "2025-01" <= m["mes"] <= "2025-10")
        assert s["anio"] == pytest.approx(este_anio + s["mes"], abs=0.05)
        assert s["anio_anterior_mismo_dia"] == pytest.approx(anio_pasado + s["mismo_mes_anio_anterior"], abs=0.05)
    # las ventanas parciales son exactamente las pedidas
    f = d["facturacion"]
    assert f["mes"] == pytest.approx(sum(r["importe"] for r in odoo.facturacion_por_mes([(date(2026, 11, 1), date(2026, 11, 6))])))
    assert f["mismo_mes_anio_anterior"] == pytest.approx(
        sum(r["importe"] for r in odoo.facturacion_por_mes([(date(2025, 11, 1), date(2025, 11, 6))])))
    # niveles realistas por empresa (€/mes): STINSA ~0,9-1,3 M; TRANSARGI ~0,3-0,5 M
    stinsa = direccion.calcular_finanzas(odoo, HOY, [1])["facturacion"]["meses"]
    transargi = direccion.calcular_finanzas(odoo, HOY, [7])["facturacion"]["meses"]
    assert all(850_000 < m["importe"] < 1_350_000 for m in stinsa)
    assert all(300_000 < m["importe"] < 520_000 for m in transargi)


def test_cobros_y_pagos_por_antiguedad():
    d = direccion.calcular_finanzas(MockOdoo(), HOY)
    for clave in ("cobros", "pagos"):
        p = d[clave]
        assert [t["tramo"] for t in p["tramos"]] == ["por_vencer", "1_30", "31_60", "61_90", "mas_90"]
        assert all(t["importe"] > 0 and t["n"] > 0 for t in p["tramos"])          # algo vencido en cada tramo
        assert sum(t["importe"] for t in p["tramos"]) == pytest.approx(p["total"], abs=0.05)
        assert sum(t["n"] for t in p["tramos"]) == p["n"]
        assert p["vencido"] == pytest.approx(p["total"] - p["tramos"][0]["importe"], abs=0.05)
        assert p["n_vencido"] == p["n"] - p["tramos"][0]["n"]
        assert 0 < p["vence_7"] <= p["vence_30"] <= p["tramos"][0]["importe"]      # facturas que vencen esta semana
        assert 0 < len(p["principales"]) <= 8
        importes = [x["importe"] for x in p["principales"]]
        assert importes == sorted(importes, reverse=True)
        assert all(0 <= x["vencido"] <= x["importe"] and x["n"] > 0 and x["nombre"] for x in p["principales"])
    assert d["cobros"]["total"] > d["pagos"]["total"]
    s = d["sin_facturar"]
    assert s["importe"] > s["importe_antiguo"] > 0 and s["pedidos"] >= s["antiguos"] > 0


def test_finanzas_sigue_si_falta_una_aplicacion_o_falla_una_parte(monkeypatch):
    odoo = MockOdoo()
    odoo.instalados = {"account"}
    monkeypatch.setattr(odoo, "pendiente_por_vencimiento", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("caído")))
    d = direccion.calcular_finanzas(odoo, HOY)
    assert d["ventas"] is None and d["sin_facturar"] is None and d["cobros"] is None and d["pagos"] is None
    assert d["facturacion"]["meses"] and d["empresas"]
    assert d["avisos"] == ["Ventas: la aplicación no está instalada en Odoo.",
                           "Pedidos sin facturar: la aplicación no está instalada en Odoo.",
                           "Cobros: Odoo no ha respondido.", "Pagos: Odoo no ha respondido."]


def test_comercial_compara_con_el_mismo_dia_del_mes_anterior_y_filtra_empresa():
    d = direccion.calcular(MockOdoo(), HOY)
    crm = d["crm"]
    assert (crm["ganadas_mes"], crm["ganado_mes"], crm["nuevas_mes"]) == (5, 61050, 11)
    assert (crm["ganadas_mes_anterior"], crm["ganado_mes_anterior"], crm["nuevas_mes_anterior"]) == (4, 51300, 9)
    assert d["empresa"] is None and d["ventas"]["mes"] == 461350.5
    solo = direccion.calcular(MockOdoo(), HOY, [7])
    assert solo["empresa"] == 7 and [e["empresa"] for e in solo["empresas"]] == ["TRANSARGI S.L.U"]
    assert solo["crm"]["ganadas_mes"] == 2 and solo["ventas"]["mes"] == 148900


# ------------------------------------------------------------------ cliente real: dominios v15 y empresas (sin red)

class _Grabadora:
    def __init__(self, respuestas=None):
        self.llamadas = []
        self.respuestas = respuestas or []

    def __call__(self, model, method, args, kwargs=None):
        self.llamadas.append((model, method, args, kwargs or {}))
        return self.respuestas.pop(0) if self.respuestas else []


def _cliente(monkeypatch, respuestas=None):
    c = OdooClient(SimpleNamespace(company_ids=[1, 7]))
    g = _Grabadora(respuestas)
    monkeypatch.setattr(c, "_call", g)
    return c, g


def test_cliente_restringe_empresas_y_escribe_dominios_v15(monkeypatch):
    fila = {"invoice_date:month": "noviembre 2026", "amount_untaxed_signed": 1000.5, "__count": 3,
            "__domain": ["&", "&", ["invoice_date", ">=", "2026-11-01"], ["invoice_date", "<", "2026-12-01"]]}
    c, g = _cliente(monkeypatch, [[fila]])
    assert c.facturacion_por_mes([(date(2026, 11, 1), date(2026, 11, 6))], empresas=[7]) == [{"mes": "2026-11", "importe": 1000.5, "n": 3}]
    model, method, (dominio, campos, agrupar), kw = g.llamadas[-1]
    assert (model, method, campos, agrupar, kw) == ("account.move", "read_group", ["amount_untaxed_signed:sum"], ["invoice_date:month"], {"lazy": False})
    assert ["move_type", "in", ["out_invoice", "out_refund"]] in dominio and ["state", "=", "posted"] in dominio
    assert ["invoice_date", ">", "2026-10-31"] in dominio and ["invoice_date", "<", "2026-11-06"] in dominio
    assert not any(isinstance(h, list) and h[1] == ">=" for h in dominio)   # el único «>=» del __domain será el del grupo
    assert dominio[-1] == ["company_id", "in", [7]]
    c.facturacion_por_mes([(date(2026, 11, 1), date(2026, 11, 6))], empresas=[99])            # nunca amplía
    assert g.llamadas[-1][2][0][-1] == ["company_id", "in", []]
    c.ventas_por_mes([(date(2026, 1, 1), date(2026, 2, 1)), (date(2025, 1, 1), date(2025, 2, 1))])
    dominio = g.llamadas[-1][2][0]
    assert g.llamadas[-1][0] == "sale.order" and dominio[-1] == ["company_id", "in", [1, 7]]
    assert dominio[1:4] == ["|", "&", ["date_order", ">", "2025-12-31 23:59:59"]]           # fecha y hora: límites explícitos
    assert ["date_order", "<", "2026-02-01 00:00:00"] in dominio
    c.crm_ganadas("2026-10-01", "2026-10-06", empresas=[1])                                   # empresa pedida: sin «sin empresa»
    assert g.llamadas[-1][2][0][-1] == ["company_id", "in", [1]] and "|" not in g.llamadas[-1][2][0]
    c.crm_ganadas("2026-10-01")
    assert g.llamadas[-1][2][0][-3:] == ["|", ["company_id", "=", False], ["company_id", "in", [1, 7]]]


def test_cliente_pagos_en_positivo_y_principales_ordenados_por_odoo(monkeypatch):
    dias = [{"invoice_date_due:day": "05 nov. 2026", "amount_residual_signed": -1200.0, "__count": 2,
             "__domain": [["invoice_date_due", ">=", "2026-11-05"], ["invoice_date_due", "<", "2026-11-06"]]}]
    antes = [{"company_id": [1, "STINSA"], "amount_residual_signed": -300.0, "__count": 1}]
    c, g = _cliente(monkeypatch, [dias, antes])
    r = c.pendiente_por_vencimiento("pagar", HOY)
    assert r == {"dias": [{"dia": "2026-11-05", "importe": 1200.0, "n": 2}], "antes": {"importe": 300.0, "n": 1}}
    assert ["move_type", "=", "in_invoice"] in g.llamadas[0][2][0]
    assert ["invoice_date_due", ">", "2026-08-06"] in g.llamadas[0][2][0]           # 90 días atrás, día a día
    assert ["invoice_date_due", "<", "2026-08-07"] in g.llamadas[1][2][0]           # lo anterior, en total
    top = [{"commercial_partner_id": [55, "Gasóleos Levante, S.L."], "amount_residual_signed": -9000.0, "__count": 4}]
    venc = [{"commercial_partner_id": [55, "Gasóleos Levante, S.L."], "amount_residual_signed": -2500.0, "__count": 1}]
    c, g = _cliente(monkeypatch, [top, venc])
    assert c.principales_pendiente("pagar", HOY, 8) == [{"nombre": "Gasóleos Levante, S.L.", "importe": 9000.0, "vencido": 2500.0, "n": 4}]
    assert g.llamadas[0][3] == {"lazy": False, "orderby": "amount_residual_signed asc", "limit": 8}
    assert [["commercial_partner_id", "in", [55]], ["invoice_date_due", "<", "2026-11-05"]] == g.llamadas[1][2][0][-2:]


def test_dominio_analitico_de_un_centro(monkeypatch):
    assert dominio_analitico([101], []) == [["analytic_account_id", "in", [101]]]
    assert dominio_analitico([], [204, 204]) == [["analytic_tag_ids", "in", [204]]]
    assert dominio_analitico([102, 101], [204]) == ["|", ["analytic_account_id", "in", [101, 102]], ["analytic_tag_ids", "in", [204]]]
    assert dominio_analitico([], []) == []
    fila = {"date:month": "octubre 2026", "balance": -5000.0, "__count": 7,
            "__domain": [["date", ">=", "2026-10-01"], ["date", "<", "2026-11-01"]]}
    c, g = _cliente(monkeypatch, [[fila]])
    assert c.analitica_por_mes("income", [], [], [(date(2026, 10, 1), date(2026, 10, 6))]) == []
    assert g.llamadas == []                                                          # centro sin analítica: ni se pregunta
    assert c.analitica_por_mes("income", [101], [204], [(date(2026, 10, 1), date(2026, 10, 6))]) == [{"mes": "2026-10", "importe": 5000.0, "n": 7}]
    model, method, (dominio, campos, agrupar), _ = g.llamadas[-1]
    assert (model, method, campos, agrupar) == ("account.move.line", "read_group", ["balance:sum"], ["date:month"])
    assert dominio[:5] == [["parent_state", "=", "posted"], ["account_id.internal_group", "=", "income"],
                           "|", ["analytic_account_id", "in", [101]], ["analytic_tag_ids", "in", [204]]]
    with pytest.raises(PermissionError):
        c.analitica_por_mes("asset", [101], [], [(date(2026, 10, 1), date(2026, 10, 6))])


# ------------------------------------------------------------------ centros

def test_centros_ingresos_gastos_y_margen():
    odoo = MockOdoo()
    centros = [{"id": 1, "nombre": "Grao de Castellón"}, {"id": 2, "nombre": "Sevilla"}]
    analitica = [{"centro_id": 1, "tipo": "cuenta", "odoo_id": 101, "nombre": "Grao de Castellón"},
                 {"centro_id": 1, "tipo": "etiqueta", "odoo_id": 204, "nombre": "Viajes Sevilla"}]
    d = direccion.calcular_centros(odoo, HOY, centros, analitica)
    grao, sevilla = d["centros"]
    assert sevilla == {"centro_id": 2, "nombre": "Sevilla", "configurado": False, "ingresos": None, "gastos": None, "margen": None}
    assert grao["configurado"] is True and d["avisos"] == []
    claves = {"mes", "mes_anterior_mismo_dia", "anio", "anio_anterior_mismo_dia"}
    assert set(grao["ingresos"]) == set(grao["gastos"]) == set(grao["margen"]) == claves
    for k in claves:
        assert grao["ingresos"][k] > grao["gastos"][k] > 0
        assert grao["margen"][k] == pytest.approx(grao["ingresos"][k] - grao["gastos"][k], abs=0.01)
    assert grao["ingresos"]["anio"] > grao["ingresos"]["mes"] > 0
    # determinista: lo mismo que pedir directamente la cuenta 101 y la etiqueta 204
    mes = odoo.analitica_por_mes("income", [101], [204], [(date(2026, 11, 1), date(2026, 11, 6))])
    assert grao["ingresos"]["mes"] == pytest.approx(sum(f["importe"] for f in mes), abs=0.01)
    assert direccion.calcular_centros(MockOdoo(), HOY, centros, analitica)["centros"] == d["centros"]


def test_un_centro_que_falla_no_tumba_a_los_demas(monkeypatch):
    odoo = MockOdoo()
    original = odoo.analitica_por_mes

    def analitica(grupo, cuentas, etiquetas, ventanas, empresas=None):
        if 102 in cuentas:
            raise RuntimeError("caído")
        return original(grupo, cuentas, etiquetas, ventanas, empresas)

    monkeypatch.setattr(odoo, "analitica_por_mes", analitica)
    d = direccion.calcular_centros(odoo, HOY, [{"id": 1, "nombre": "Grao de Castellón"}, {"id": 2, "nombre": "Castellón de la Plana"}],
                                   [{"centro_id": 1, "tipo": "cuenta", "odoo_id": 101}, {"centro_id": 2, "tipo": "cuenta", "odoo_id": 102}])
    assert d["centros"][0]["margen"] is not None
    assert d["centros"][1]["configurado"] is True and d["centros"][1]["ingresos"] is None and d["centros"][1]["margen"] is None
    assert d["avisos"] == ["Centros (Castellón de la Plana): Odoo no ha respondido."]


def test_ruta_centros_lee_supabase_con_el_token_de_quien_mira(entorno, monkeypatch):
    from servicios import supa
    sb, odoo, c = entorno
    tokens = []
    leer = supa.leer
    monkeypatch.setattr(supa, "leer", lambda token, tabla, params: tokens.append((token, tabla)) or leer(token, tabla, params))
    r = c.get("/api/odoo/centros", headers=DIR)
    assert r.status_code == 200
    d = r.json()
    assert tokens == [("tok-dir", "centros"), ("tok-dir", "centro_analitica")]
    assert [x["nombre"] for x in d["centros"]] == ["Grao de Castellón", "Sevilla"]        # el inactivo no sale
    assert d["centros"][0]["configurado"] and d["centros"][0]["margen"]["mes"] > 0
    assert d["centros"][1] == {"centro_id": 2, "nombre": "Sevilla", "configurado": False, "ingresos": None, "gastos": None, "margen": None}
    assert d["modo"] == "simulado" and d["hoy"] == "2026-11-05" and d["empresa"] is None
    esperado = direccion.calcular_centros(MockOdoo(), HOY, [{"id": 1, "nombre": "Grao de Castellón"}, {"id": 2, "nombre": "Sevilla"}],
                                          sb.tablas["centro_analitica"])
    assert d["centros"] == esperado["centros"]
    # sin la tabla de analítica (o sin conexión): aviso claro y el resto de la respuesta
    monkeypatch.setattr(supa, "leer", lambda *a: (_ for _ in ()).throw(AppError("x", 503, "sin_conexion_datos")))
    d = c.get("/api/odoo/centros", headers=DIR).json()
    assert d["centros"] == [] and "centros" in d["avisos"][0]


def test_ruta_centros_sin_supabase_en_modo_simulado(monkeypatch):
    import servicios.main as main
    for v in ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("ODOO_MODE", "mock")
    monkeypatch.setattr(main, "_odoo", MockOdoo())
    from fastapi.testclient import TestClient
    d = TestClient(main.app).get("/api/odoo/centros").json()
    assert d["centros"] == [] and d["modo"] == "simulado" and "base de datos" in d["avisos"][0]


# ------------------------------------------------------------------ permisos y parámetro «empresa»

def test_permisos_de_las_rutas_nuevas(entorno):
    sb, odoo, c = entorno
    for ruta in ("/api/odoo/finanzas", "/api/odoo/centros", "/api/odoo/analitica"):
        assert c.get(ruta, headers=ANA).status_code == 403, ruta            # chófer
        assert c.get(ruta, headers=JEFA_H).status_code == 200, ruta         # superadministradora
        assert c.get(ruta).status_code == 401, ruta                          # sin sesión
    assert c.get("/api/odoo/analitica", headers=ADMIN).status_code == 200
    assert c.get("/api/odoo/finanzas", headers=ADMIN).status_code == 403
    assert c.get("/api/odoo/centros", headers=ADMIN).status_code == 403
    assert c.get("/api/odoo/finanzas", headers=DIR).status_code == 200
    assert c.get("/api/odoo/centros", headers=DIR).status_code == 200
    assert c.get("/api/odoo/analitica", headers=DIR).status_code == 403
    assert c.get("/api/odoo/comercial", headers=DIR).status_code == 403     # «direccion.ver» es otro permiso


def test_parametro_empresa(entorno):
    sb, odoo, c = entorno
    for ruta in ("/api/odoo/finanzas", "/api/odoo/centros", "/api/odoo/analitica", "/api/odoo/comercial"):
        r = c.get(ruta, params={"empresa": 99}, headers=JEFA_H)
        assert r.status_code == 400 and r.json()["codigo"] == "empresa_invalida" and "empresa" in r.json()["error"], ruta
        assert c.get(ruta, params={"empresa": "stinsa"}, headers=JEFA_H).status_code == 400, ruta
    todo = c.get("/api/odoo/finanzas", headers=JEFA_H).json()
    solo = c.get("/api/odoo/finanzas", params={"empresa": 7}, headers=JEFA_H).json()
    assert todo["empresa"] is None and solo["empresa"] == 7
    assert len(solo["empresas"]) == 2                                            # el selector sigue teniendo las dos
    assert 0 < solo["facturacion"]["mes"] < todo["facturacion"]["mes"]
    assert 0 < solo["cobros"]["total"] < todo["cobros"]["total"]
    assert solo["sin_facturar"] == {"importe": 61920.75, "pedidos": 24, "antiguos": 4, "importe_antiguo": 11305.5}
    com = c.get("/api/odoo/comercial", params={"empresa": 1}, headers=JEFA_H).json()
    assert com["empresa"] == 1 and [e["empresa"] for e in com["empresas"]] == ["STINSA"]
    cat = c.get("/api/odoo/analitica", params={"empresa": 7}, headers=JEFA_H).json()
    assert {x["empresa"] for x in cat["cuentas"]} == {"TRANSARGI S.L.U", None}


def test_catalogo_analitico(entorno):
    sb, odoo, c = entorno
    d = c.get("/api/odoo/analitica", headers=ADMIN).json()
    assert d["modo"] == "simulado" and d["avisos"] == []
    assert {"id", "nombre", "codigo", "empresa"} == set(d["cuentas"][0])
    nombres = {x["nombre"] for x in d["cuentas"]}
    assert {"Grao de Castellón", "Castellón de la Plana", "Burriana", "Sevilla", "Montaje Castellón", "Montaje Burriana",
            "Montaje Sevilla"} <= nombres
    assert {"id": 204, "nombre": "Viajes Sevilla"} in d["etiquetas"]


def test_finanzas_se_reutiliza_diez_minutos(entorno, monkeypatch):
    sb, odoo, c = entorno
    llamadas = []
    original = odoo.facturacion_por_mes
    monkeypatch.setattr(odoo, "facturacion_por_mes", lambda *a, **k: llamadas.append(1) or original(*a, **k))
    primera = c.get("/api/odoo/finanzas", headers=JEFA_H).json()
    assert c.get("/api/odoo/finanzas", headers=JEFA_H).json() == primera
    assert len(llamadas) == 2                                                    # una sola serie (2 llamadas), no dos
    c.get("/api/odoo/finanzas", params={"empresa": 1}, headers=JEFA_H)
    assert len(llamadas) == 4                                                    # otra empresa, otra entrada
