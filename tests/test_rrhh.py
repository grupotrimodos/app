"""Fichaje, ausencias y chófer: envío a Odoo con los permisos del propio usuario (Supabase simulado)."""
import re

import httpx
import pytest

from servicios.mock_odoo import MockOdoo

UID = "u-ana"
JEFA = "u-jefa"


class SupabaseFalso:
    """Auth + REST mínimos: tokens → usuario; tablas en memoria; filtros eq./in. y PATCH."""

    def __init__(self):
        self.tokens = {"tok-ana": UID, "tok-jefa": JEFA}
        self.tablas = {
            "usuarios": [
                {"id": UID, "nombre": "Ana", "activo": True, "permisos": ["fichaje.fichar", "ausencias.pedir", "chofer.usar"], "odoo_employee_id": 41},
                {"id": JEFA, "nombre": "Jefa", "activo": True, "permisos": ["fichaje.fichar"], "odoo_employee_id": 7, "es_admin": True},
            ],
            "fichajes": [], "ausencias": [], "odoo_sincronizacion": [],
            "vehiculos": [{"id": 1, "matricula": "4521 LKM", "activo": True}, {"id": 2, "matricula": "7832 MHT", "activo": True}],
        }
        self.parches = []
        self.inserciones = []

    def _filtra(self, filas, params):
        for k, v in params.items():
            if k in ("select", "order"):
                continue
            op, _, val = v.partition(".")
            if op == "eq":
                filas = [f for f in filas if str(f.get(k)).lower() == val.lower()]
            elif op == "in":
                vals = val.strip("()").split(",")
                filas = [f for f in filas if str(f.get(k)) in vals]
            elif op == "is" and val == "null":
                filas = [f for f in filas if f.get(k) is None]
        return filas

    def handler(self, req: httpx.Request):
        if req.headers.get("apikey") == "clave-secreta" and "authorization" not in req.headers:
            uid = "servicio"   # clave de servidor: ve todo (sin RLS)
        else:
            uid = self.tokens.get(req.headers.get("authorization", "")[7:])
        if not uid:
            return httpx.Response(401, json={})
        if req.url.path == "/auth/v1/user":
            return httpx.Response(200, json={"id": uid})
        if req.url.path == "/rest/v1/rpc/mis_permisos":
            return httpx.Response(200, json=next(f["permisos"] for f in self.tablas["usuarios"] if f["id"] == uid))
        tabla = req.url.path.rsplit("/", 1)[1]
        params = dict(req.url.params)
        filas = self.tablas[tabla]
        if req.method == "POST":
            import json
            datos = json.loads(req.content)
            for d in datos if isinstance(datos, list) else [datos]:
                clave = req.url.params.get("on_conflict")
                previa = next((f for f in self.tablas.setdefault(tabla, []) if clave and f.get(clave) == d.get(clave)), None)
                if previa:
                    previa.update(d)
                else:
                    self.tablas[tabla].append({"id": len(self.tablas[tabla]) + 100, **d})
            self.inserciones.append((tabla, datos))
            return httpx.Response(201)
        if tabla in ("fichajes", "ausencias", "usuarios") and uid not in (JEFA, "servicio"):   # RLS: Ana solo ve lo suyo
            filas = [f for f in filas if f.get("usuario_id", f.get("id")) == uid]
        filas = self._filtra(filas, params)
        if req.method == "GET":
            if params.get("order", "").startswith("momento"):
                filas = sorted(filas, key=lambda f: (f["momento"], f["id"]))
            return httpx.Response(200, json=filas)
        if req.method == "PATCH":
            import json
            datos = json.loads(req.content)
            for f in filas:
                f.update(datos)
            self.parches.append((tabla, params, datos))
            return httpx.Response(204)
        return httpx.Response(405)


@pytest.fixture
def entorno(monkeypatch):
    import servicios.auth as auth
    import servicios.main as main
    import servicios.supa as supa
    sb = SupabaseFalso()
    monkeypatch.setenv("SUPABASE_URL", "https://proyecto.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "clave-publica")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "clave-secreta")
    import servicios.rrhh as rrhh
    rrhh._cache_tipos.clear()
    transporte = httpx.MockTransport(sb.handler)
    monkeypatch.setattr(auth, "_cliente_http", lambda: httpx.Client(transport=transporte))
    monkeypatch.setattr(supa, "_cliente", lambda: httpx.Client(transport=transporte))
    odoo = MockOdoo()
    monkeypatch.setattr(main, "_odoo", odoo)
    monkeypatch.setenv("RRHH_DRY_RUN", "false")
    auth._cache.clear()
    from fastapi.testclient import TestClient
    yield sb, odoo, TestClient(main.app)
    auth._cache.clear()


ANA = {"Authorization": "Bearer tok-ana"}


def _fichaje(sb, i, tipo, hora, usuario=UID, origen="app"):
    sb.tablas["fichajes"].append({"id": i, "usuario_id": usuario, "tipo": tipo, "momento": f"2026-11-02T{hora}:00+01:00",
                                  "origen": origen, "odoo_estado": "pendiente", "odoo_error": None})


def test_jornada_con_pausa_se_envia_a_odoo_como_dos_asistencias(entorno):
    sb, odoo, c = entorno
    for i, (t, h) in enumerate([("entrada", "07:00"), ("pausa", "11:00"), ("reanudar", "11:30"), ("salida", "15:00")], 1):
        _fichaje(sb, i, t, h)
    r = c.post("/api/rrhh/fichajes/sincronizar", json={}, headers=ANA).json()
    assert r == {"enviados": 4, "errores": 0}
    asis = sorted(odoo.asistencias.values(), key=lambda a: a["check_in"])
    assert [(a["check_in"], a["check_out"]) for a in asis] == [
        ("2026-11-02 06:00:00", "2026-11-02 10:00:00"), ("2026-11-02 10:30:00", "2026-11-02 14:00:00")]   # en UTC
    assert all(a["employee_id"] == 41 for a in asis)
    assert {f["odoo_estado"] for f in sb.tablas["fichajes"]} == {"enviado"}
    assert c.post("/api/rrhh/fichajes/sincronizar", json={}, headers=ANA).json()["enviados"] == 0   # nada pendiente


def test_salida_sin_entrada_en_odoo_queda_en_error_y_para(entorno):
    sb, odoo, c = entorno
    _fichaje(sb, 1, "salida", "15:00")
    _fichaje(sb, 2, "entrada", "16:00")
    r = c.post("/api/rrhh/fichajes/sincronizar", json={}, headers=ANA).json()
    assert r == {"enviados": 0, "errores": 1}
    f1, f2 = sb.tablas["fichajes"]
    assert f1["odoo_estado"] == "error" and "entrada abierta" in f1["odoo_error"] and f2["odoo_estado"] == "pendiente"


def test_sin_id_de_empleado_se_marca_y_no_toca_odoo(entorno):
    sb, odoo, c = entorno
    sb.tablas["usuarios"][0]["odoo_employee_id"] = None
    _fichaje(sb, 1, "entrada", "07:00")
    c.post("/api/rrhh/fichajes/sincronizar", json={}, headers=ANA)
    assert sb.tablas["fichajes"][0]["odoo_estado"] == "sin_empleado" and odoo.asistencias == {}


def test_dry_run_marca_simulado_sin_escribir_en_odoo(entorno, monkeypatch):
    sb, odoo, c = entorno
    monkeypatch.delenv("RRHH_DRY_RUN")          # por defecto: modo prueba, aunque DECA tenga DRY_RUN=false
    monkeypatch.setenv("DRY_RUN", "false")
    _fichaje(sb, 1, "entrada", "07:00")
    c.post("/api/rrhh/fichajes/sincronizar", json={}, headers=ANA)
    assert sb.tablas["fichajes"][0]["odoo_estado"] == "simulado" and odoo.asistencias == {}


def test_no_se_pueden_enviar_fichajes_de_otro_sin_permiso(entorno):
    sb, odoo, c = entorno
    _fichaje(sb, 1, "entrada", "07:00", usuario=JEFA)
    r = c.post("/api/rrhh/fichajes/sincronizar", json={"usuario_id": JEFA}, headers=ANA).json()
    assert r == {"enviados": 0, "errores": 0} and odoo.asistencias == {}   # sus permisos no le dejan ver esos fichajes


def test_ausencia_aprobada_se_crea_en_odoo_con_su_tipo(entorno, monkeypatch):
    sb, odoo, c = entorno
    monkeypatch.setenv("ODOO_TIPOS_AUSENCIA", '{"vacaciones": 1}')
    sb.tablas["ausencias"].append({"id": 5, "usuario_id": UID, "tipo": "vacaciones", "desde": "2026-12-01", "hasta": "2026-12-05",
                                   "motivo": None, "estado": "aprobada", "odoo_estado": "pendiente"})
    jefa = {"Authorization": "Bearer tok-jefa"}
    assert c.post("/api/rrhh/ausencias/5/sincronizar", headers=jefa).json() == {"estado": "enviado"}
    (aus,) = odoo.ausencias.values()
    assert aus == {"employee_id": 41, "tipo_id": 1, "desde": "2026-12-01", "hasta": "2026-12-05", "nombre": "Vacaciones"}
    assert c.post("/api/rrhh/ausencias/5/sincronizar", headers=jefa).json() == {"estado": "enviado"}   # no se duplica
    assert len(odoo.ausencias) == 1


def test_ausencia_pendiente_no_se_envia_y_el_tipo_de_odoo_se_elige_solo(entorno, monkeypatch):
    sb, odoo, c = entorno
    monkeypatch.delenv("ODOO_TIPOS_AUSENCIA", raising=False)
    sb.tablas["ausencias"].append({"id": 6, "usuario_id": UID, "tipo": "medico", "desde": "2026-12-01", "hasta": "2026-12-01",
                                   "motivo": None, "estado": "pendiente", "odoo_estado": "pendiente"})
    assert c.post("/api/rrhh/ausencias/6/sincronizar", headers=ANA).json() == {"estado": "no_aplica"}
    sb.tablas["ausencias"][0]["estado"] = "aprobada"
    assert c.post("/api/rrhh/ausencias/6/sincronizar", headers=ANA).json() == {"estado": "enviado"}
    (aus,) = odoo.ausencias.values()
    assert aus["tipo_id"] == 2   # «Baja por enfermedad»: elegido por su nombre, sin configurar nada


def test_ausencia_sin_tipo_en_odoo_queda_en_error_explicado(entorno, monkeypatch):
    sb, odoo, c = entorno
    monkeypatch.delenv("ODOO_TIPOS_AUSENCIA", raising=False)
    monkeypatch.setattr(odoo, "tipos_ausencia", lambda: [{"id": 9, "name": "Formación"}])
    sb.tablas["ausencias"].append({"id": 6, "usuario_id": UID, "tipo": "medico", "desde": "2026-12-01", "hasta": "2026-12-01",
                                   "motivo": None, "estado": "aprobada", "odoo_estado": "pendiente"})
    assert c.post("/api/rrhh/ausencias/6/sincronizar", headers=ANA).json() == {"estado": "error"}
    assert "tipo de ausencia" in sb.tablas["ausencias"][0]["odoo_error"] and odoo.ausencias == {}


def test_la_ficha_de_empleado_se_encuentra_sola_por_correo_o_credencial(entorno, monkeypatch):
    from servicios import rrhh, supa
    sb, odoo, c = entorno
    monkeypatch.setattr(rrhh, "guardar_enlaces", lambda: True)   # como con el Odoo real
    ana = sb.tablas["usuarios"][0]
    ana.update(odoo_employee_id=None, email="ANA@grupotrimodos.com", codigo=None)
    assert rrhh.empleado("tok-ana", UID) == (41, None)
    assert ana["odoo_employee_id"] is None            # con el token del usuario no se guarda (no puede editar su ficha)
    ana.update(email="c001@pin.grupotrimodos.com", codigo="C001")   # entra con código: se busca por credencial
    assert rrhh.empleado(supa.SERVICIO, UID) == (41, None)
    assert ana["odoo_employee_id"] == 41              # la sincronización sí lo deja enlazado
    ana.update(odoo_employee_id=None, codigo="X999")
    emp, motivo = rrhh.empleado(supa.SERVICIO, UID)
    assert emp is None and "X999" in motivo


def test_chofer_hoy_detecta_camion_de_la_flota_en_modo_simulado(entorno):
    sb, odoo, c = entorno
    r = c.get("/api/chofer/hoy", headers=ANA).json()
    assert r["simulado"] is True and r["tarjeta"]["matricula"] in ("4521 LKM", "7832 MHT")
    assert c.get("/api/chofer/hoy", headers=ANA).json()["tarjeta"] == r["tarjeta"]          # siempre el mismo para el mismo chófer
    sb.tablas["usuarios"][1]["es_admin"] = False
    assert c.get("/api/chofer/hoy", headers={"Authorization": "Bearer tok-jefa"}).status_code == 403   # sin permiso de chófer


def test_cliente_real_solo_permite_las_operaciones_de_rrhh_previstas():
    from servicios.odoo_client import ALLOWED_CALLS
    hr = {c for c in ALLOWED_CALLS if c[0].startswith("hr.")}
    assert hr == {("hr.attendance", "search_read"), ("hr.attendance", "create"), ("hr.attendance", "write"),
                  ("hr.leave", "create"), ("hr.attendance", "check_access_rights"), ("hr.leave", "check_access_rights"),
                  ("hr.leave.type", "search_read"), ("hr.employee", "search_read"), ("hr.employee", "check_access_rights")}
    # fuera de RRHH, la sincronización solo LEE (flota y aplicaciones instaladas)
    assert {c for c in ALLOWED_CALLS if c[0] in ("fleet.vehicle", "ir.module.module")} == {
        ("fleet.vehicle", "search_read"), ("ir.module.module", "search_read")}
    assert not any(m == "unlink" for _, m in ALLOWED_CALLS)


def test_entrada_con_otra_entrada_abierta_en_odoo_queda_en_error(entorno):
    sb, odoo, c = entorno
    odoo.abrir_asistencia(41, "2026-11-01 06:00:00")          # ayer no se cerró
    _fichaje(sb, 1, "entrada", "07:00")
    assert c.post("/api/rrhh/fichajes/sincronizar", json={}, headers=ANA).json() == {"enviados": 0, "errores": 1}
    assert "sin cerrar" in sb.tablas["fichajes"][0]["odoo_error"] and len(odoo.asistencias) == 1


def test_una_correccion_rechazada_por_odoo_no_frena_los_demas(entorno):
    sb, odoo, c = entorno
    _fichaje(sb, 1, "salida", "06:00", origen="correccion")   # salida sin entrada en Odoo: error
    _fichaje(sb, 2, "entrada", "07:00")
    r = c.post("/api/rrhh/fichajes/sincronizar", json={}, headers=ANA).json()
    assert r == {"enviados": 1, "errores": 1}
    assert [f["odoo_estado"] for f in sb.tablas["fichajes"]] == ["error", "enviado"]


def test_ausencias_sin_permiso_no_entra(entorno):
    sb, odoo, c = entorno
    sb.tablas["usuarios"][1]["es_admin"] = False
    assert c.post("/api/rrhh/ausencias/1/sincronizar", headers={"Authorization": "Bearer tok-jefa"}).status_code == 403


def test_cada_ruta_de_la_api_python_tiene_su_rewrite_en_next():
    from pathlib import Path
    from servicios.main import app
    config = (Path(__file__).resolve().parent.parent / "next.config.ts").read_text(encoding="utf-8")
    prefijos = {r.path.split("/")[2] for r in app.routes if getattr(r, "path", "").startswith("/api/")}
    for p in prefijos:
        assert f'source: "/api/{p}/:path*"' in config, p


# ------------------------------------------------------------------ sincronización automática

def test_sincronizacion_solo_con_cron_secret_o_permiso(entorno, monkeypatch):
    sb, odoo, c = entorno
    monkeypatch.setenv("CRON_SECRET", "secreto-cron")
    assert c.get("/api/odoo/procesar").status_code == 401
    assert c.get("/api/odoo/procesar", headers={"Authorization": "Bearer otro"}).status_code == 401
    assert c.get("/api/odoo/procesar", headers=ANA).status_code == 403          # sin «admin.sincronizacion»
    assert c.get("/api/odoo/estado", headers=ANA).status_code == 403
    r = c.get("/api/odoo/procesar", headers={"Authorization": "Bearer secreto-cron"})
    assert r.status_code == 200 and r.json()["origen"] == "automatica"
    assert sb.inserciones[-1][0] == "odoo_sincronizacion"                      # queda registrada


def test_sincronizacion_envia_lo_pendiente_de_todos_y_enlaza_fichas(entorno, monkeypatch):
    from servicios import rrhh
    sb, odoo, c = entorno
    monkeypatch.setattr(rrhh, "guardar_enlaces", lambda: True)
    sb.tablas["usuarios"][0].update(odoo_employee_id=None, email="ana@grupotrimodos.com", codigo=None)
    _fichaje(sb, 1, "entrada", "07:00")
    _fichaje(sb, 2, "salida", "15:00")
    sb.tablas["ausencias"].append({"id": 7, "usuario_id": UID, "tipo": "vacaciones", "desde": "2026-12-01", "hasta": "2026-12-02",
                                   "motivo": None, "estado": "aprobada", "odoo_estado": "pendiente"})
    r = c.post("/api/odoo/procesar", headers={"Authorization": "Bearer tok-jefa"}).json()   # la jefa es superadmin
    assert r["origen"].startswith("manual")
    assert r["resultado"]["empleados"]["enlazados"] == 1 and sb.tablas["usuarios"][0]["odoo_employee_id"] == 41
    assert r["resultado"]["fichajes"]["enviados"] == 2 and len(odoo.asistencias) == 1
    assert r["resultado"]["ausencias"] == {"estado": "ok", "enviado": 1}
    assert r["resultado"]["vehiculos"]["importados_o_actualizados"] == 2
    camion = next(v for v in sb.tablas["vehiculos"] if v["matricula"] == "4521 LKM")
    assert camion["odoo_id"] == 501 and camion["activo"] is True                # existente: se enlaza, no se duplica
    assert any(v["matricula"] == "9910 NBC" for v in sb.tablas["vehiculos"])    # nuevo de la flota


def test_sincronizacion_se_salta_lo_que_no_tiene_su_aplicacion_en_odoo(entorno, monkeypatch):
    sb, odoo, c = entorno
    monkeypatch.setattr(odoo, "instalados", {"hr", "hr_attendance"})
    r = c.post("/api/odoo/procesar", headers={"Authorization": "Bearer tok-jefa"}).json()["resultado"]
    assert r["ausencias"]["estado"] == "sin_app" and "Ausencias" in r["ausencias"]["detalle"]
    assert r["vehiculos"]["estado"] == "sin_app"
    assert r["fichajes"]["estado"] == "ok"
    estado = c.get("/api/odoo/estado", headers={"Authorization": "Bearer tok-jefa"}).json()
    assert {m["id"]: m["instalada"] for m in estado["mapas"]} == {
        "empleados": True, "fichajes": True, "ausencias": False, "vehiculos": False}


def test_con_odoo_simulado_no_se_guardan_empleados_ni_camiones_de_prueba(entorno):
    sb, odoo, c = entorno
    sb.tablas["usuarios"][0].update(odoo_employee_id=None, email="ana@grupotrimodos.com")
    antes = len(sb.tablas["vehiculos"])
    r = c.post("/api/odoo/procesar", headers={"Authorization": "Bearer tok-jefa"}).json()["resultado"]
    assert sb.tablas["usuarios"][0]["odoo_employee_id"] is None and len(sb.tablas["vehiculos"]) == antes
    assert "simulado" in r["vehiculos"]["aviso"]


def test_sin_clave_de_servidor_la_sincronizacion_lo_explica(entorno, monkeypatch):
    sb, odoo, c = entorno
    monkeypatch.delenv("SUPABASE_SECRET_KEY")
    r = c.post("/api/odoo/procesar", headers={"Authorization": "Bearer tok-jefa"})
    assert r.status_code == 503 and "SUPABASE_SECRET_KEY" in r.json()["error"]
