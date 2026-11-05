"""Contrato Movildata: datos documentados, permisos y fallos parciales, sin red real."""
from datetime import date, datetime, timedelta, timezone
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from servicios import auth, movildata
from servicios.auth import Usuario
from servicios.errors import AppError

AHORA = datetime(2026, 11, 2, 10, 30, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def configurar(monkeypatch):
    monkeypatch.setenv("MOVILDATA_API_KEY", "clave-prueba-no-real")
    monkeypatch.setenv("MOVILDATA_MODE", "real")
    monkeypatch.setattr(movildata, "_ahora", lambda: AHORA)
    movildata._cache.clear()
    yield
    movildata._cache.clear()


def inventario():
    return [{"Imei": f"equipo-{i}", "Matricula": f"000{i} PRB", "TipoVehiculo": "Camión"} for i in range(1, 6)]


def respuestas():
    return {
        "/Users/GetVehiculos": inventario(),
        "/Users/GetLastLocations": [
            {"idv": f"equipo-{i}", "f": "2026-11-02T11:29:00+01:00", "loc": f"40.{i},-3.{i}",
             "veloc": "0" if i == 1 else "72", "ignic": "false" if i == 1 else "true"}
            for i in range(1, 6)
        ],
        "/InfoEco/GetLastConsumptions": [
            {"Imei": f"equipo-{i}", "Matricula": f"000{i} PRB", "Tanque": 65, "LitrosTanque": 260,
             "Fecha": "2026-11-02T11:10:00+01:00"} for i in range(1, 6)
        ],
        "/Users/GetDataBetweenDates": {"DistanciaRecorrida": 200, "ConsumoTotal": 60,
                                       "FechaRegistroFin": "2026-11-02T11:29:00+01:00"},
        "/Users/GetGPSData": [],
    }


def conectar(monkeypatch, datos):
    llamadas = []

    def handler(req):
        llamadas.append(req)
        assert req.method == "GET"
        assert req.url.host == "mapi.movildata.com"
        assert req.headers["accept"] == "application/json"
        respuesta = datos[req.url.path]
        if isinstance(respuesta, Exception):
            raise respuesta
        if isinstance(respuesta, httpx.Response):
            return respuesta
        return httpx.Response(200, json=respuesta)

    monkeypatch.setattr(movildata, "_cliente", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    return llamadas


def test_cinco_matriculas_reales_normalizadas_sin_clave_ni_identificadores(monkeypatch):
    llamadas = conectar(monkeypatch, respuestas())
    r = movildata.resumen_flota()
    assert r["estado"] == "conectado" and r["simulado"] is False
    assert len(r["vehiculos"]) == 5
    v = r["vehiculos"][0]
    assert v["id"] == "0001PRB" and v["matricula"] == "0001 PRB"
    assert v["latitud"] == 40.1 and v["longitud"] == -3.1
    assert v["velocidad_kmh"] == 0 and v["motor_encendido"] is False and v["estado"] == "detenido"
    assert r["vehiculos"][1]["estado"] == "en_ruta"
    assert v["km_hoy"] == 200 and v["consumo_medio_l_100km"] == 30
    assert v["combustible_pct"] == 65 and v["combustible_litros"] == 260
    assert v["fecha_posicion"] == "2026-11-02T10:29:00+00:00"
    assert "clave-prueba" not in json.dumps(r) and "equipo-" not in json.dumps(r)
    assert len(llamadas) == 8
    diario = next(q for q in llamadas if q.url.path.endswith("GetDataBetweenDates"))
    assert diario.url.params["fechaInicio"] == "2026-11-02T00:00:00+01:00"


def test_clave_activa_modo_real_sin_variable_y_mock_explicito_se_respeta(monkeypatch):
    monkeypatch.delenv("MOVILDATA_MODE")
    assert movildata.modo() == "real"
    monkeypatch.setenv("MOVILDATA_MODE", "mock")
    assert movildata.resumen_flota()["estado"] == "simulado"
    assert movildata.resumen_flota()["vehiculos"] == []
    monkeypatch.delenv("MOVILDATA_API_KEY")
    monkeypatch.setenv("MOVILDATA_MODE", "real")
    r = movildata.resumen_flota()
    assert r["estado"] == "sin_configurar" and r["simulado"] is False and r["vehiculos"] == []


def test_datos_faltantes_y_antiguos_no_se_inventan(monkeypatch):
    datos = respuestas()
    datos["/Users/GetLastLocations"][0].update(f="2026-11-01T11:00:00+01:00", veloc="90")
    datos["/Users/GetLastLocations"][1].update(f="no-es-fecha", loc="999,20", veloc="NaN", ignic="desconocido")
    datos["/Users/GetLastLocations"][2].update(loc="0,0")
    datos["/InfoEco/GetLastConsumptions"] = []
    datos["/Users/GetDataBetweenDates"] = {"DistanciaRecorrida": None, "ConsumoTotal": None}
    conectar(monkeypatch, datos)
    v = movildata.resumen_flota()["vehiculos"]
    assert v[0]["estado"] == "sin_senal"
    assert v[1]["estado"] == "sin_datos" and v[1]["latitud"] is None
    assert v[1]["velocidad_kmh"] is None and v[1]["motor_encendido"] is None
    assert v[2]["latitud"] is None and v[2]["longitud"] is None
    assert all(x["combustible_pct"] is None and x["km_hoy"] is None for x in v)


def test_fallo_combustible_o_resumen_no_oculta_posiciones(monkeypatch):
    datos = respuestas()
    datos["/InfoEco/GetLastConsumptions"] = httpx.Response(403, text="Error clave-prueba-no-real")
    datos["/Users/GetDataBetweenDates"] = httpx.Response(429, text="Error clave-prueba-no-real")
    conectar(monkeypatch, datos)
    r = movildata.resumen_flota()
    assert r["estado"] == "parcial" and len(r["vehiculos"]) == 5
    assert r["vehiculos"][0]["latitud"] == 40.1
    assert r["vehiculos"][0]["km_hoy"] is None and r["vehiculos"][0]["avisos"]
    assert "clave-prueba-no-real" not in json.dumps(r)


@pytest.mark.parametrize("fallo", [httpx.Response(401), httpx.Response(302, headers={"location": "https://otro.example/"}),
                                   httpx.Response(200, text="<html>Error</html>"), httpx.Response(200, json={"error": "fallo"}),
                                   httpx.ConnectTimeout("URL?apikey=secreto")])
def test_fallo_inventario_es_error_saneado_no_simulacion(monkeypatch, fallo):
    llamadas = conectar(monkeypatch, {"/Users/GetVehiculos": fallo})
    r = movildata.resumen_flota()
    assert r["estado"] == "error" and r["simulado"] is False and r["vehiculos"] == []
    assert "secreto" not in json.dumps(r) and "http" not in json.dumps(r)
    assert len(llamadas) == 1


def test_cache_aislada_por_clave_y_sin_mutacion(monkeypatch):
    llamadas = conectar(monkeypatch, respuestas())
    primera = movildata._consultar("Users/GetVehiculos")
    primera[0]["Matricula"] = "CAMBIO"
    assert movildata._consultar("Users/GetVehiculos")[0]["Matricula"] == "0001 PRB"
    assert len(llamadas) == 1
    monkeypatch.setenv("MOVILDATA_API_KEY", "otra-clave")
    movildata._consultar("Users/GetVehiculos")
    assert len(llamadas) == 2
    assert all("clave" not in str(k) for k in movildata._cache)
    for k, (_, datos) in list(movildata._cache.items()):
        movildata._cache[k] = (0, datos)
    movildata._consultar("Users/GetVehiculos")
    assert len(llamadas) == 3


def test_solo_endpoints_de_lectura_permitidos(monkeypatch):
    llamadas = conectar(monkeypatch, {})
    with pytest.raises(ValueError):
        movildata._consultar("Drivers/newDriver")
    assert llamadas == []


def test_combustible_objeto_y_posicion_mas_reciente(monkeypatch):
    datos = respuestas()
    datos["/InfoEco/GetLastConsumptions"] = {"Matricula": "0001 PRB", "Tanque": 0, "LitrosTanque": 0}
    datos["/Users/GetLastLocations"].append({"idv": "equipo-1", "f": "2026-11-01T10:00:00Z", "loc": "41,-4", "veloc": 99})
    conectar(monkeypatch, datos)
    v = movildata.resumen_flota()["vehiculos"][0]
    assert v["combustible_pct"] == 0 and v["velocidad_kmh"] == 0


def test_recorrido_filtra_matricula_fecha_y_gps_invalido(monkeypatch):
    datos = respuestas()
    datos["/Users/GetGPSData"] = [
        {"Matricula": "0001 PRB", "Fecha": "2026-11-02T11:00:00+01:00", "Loc": "40,-3", "Veloc": 0, "Ignic": False},
        {"Matricula": "0001 PRB", "Fecha": "2026-11-02T10:00:00+01:00", "Loc": "41,-4", "Veloc": 75, "Ignic": True},
        {"Matricula": "0002 PRB", "Fecha": "2026-11-02T10:00:00+01:00", "Loc": "40,-3"},
        {"Matricula": "0001 PRB", "Fecha": "2026-11-01T10:00:00+01:00", "Loc": "40,-3"},
        {"Matricula": "0001 PRB", "Fecha": "2026-11-02T10:00:00+01:00", "Loc": "0,0"},
    ]
    llamadas = conectar(monkeypatch, datos)
    r = movildata.recorrido("0001PRB", date(2026, 11, 2))
    assert len(r["puntos"]) == 2 and r["puntos_totales"] == 2 and not r["simplificado"]
    assert r["puntos"][0]["velocidad_kmh"] == 75 and r["puntos"][1]["motor_encendido"] is False
    with pytest.raises(LookupError):
        movildata.recorrido("OTRO", date(2026, 11, 2))
    assert len(llamadas) == 2  # matrícula ajena nunca se consulta al proveedor


def test_recorrido_limita_rango_y_puntos(monkeypatch):
    datos = respuestas()
    datos["/Users/GetGPSData"] = [
        {"Matricula": "0001 PRB", "Fecha": (AHORA - timedelta(seconds=2000 - i)).isoformat(), "Loc": "40,-3"}
        for i in range(1500)
    ]
    llamadas = conectar(monkeypatch, datos)
    with pytest.raises(ValueError):
        movildata.recorrido("0001PRB", date(2026, 11, 3))
    with pytest.raises(ValueError):
        movildata.recorrido("0001PRB", date(2026, 10, 2))
    assert not llamadas
    r = movildata.recorrido("0001PRB", date(2026, 11, 2))
    assert len(r["puntos"]) == 1000 and r["puntos_totales"] == 1500 and r["simplificado"]
    assert r["puntos"][0]["fecha"] == datos["/Users/GetGPSData"][0]["Fecha"]
    assert r["puntos"][-1]["fecha"] == datos["/Users/GetGPSData"][-1]["Fecha"]


def test_camion_real_no_infiere_identidad_ni_tiempos():
    assert movildata.tarjeta_en_camion("u1", [{"id": 1, "matricula": "0001 PRB"}]) is None
    assert movildata.resumen_dia("u1") is None


@pytest.fixture
def api(monkeypatch):
    from servicios.main import app
    monkeypatch.setattr(auth, "supabase_configurado", lambda: True)

    def usuario(token):
        if token == "gestor":
            return Usuario(id="u1", nombre="Gestor", permisos=("flota.ver",))
        if token == "chofer":
            return Usuario(id="u2", nombre="Conductor", permisos=("chofer.usar",))
        raise AppError("Tu sesión ha caducado.", 401, "sin_sesion")

    monkeypatch.setattr(auth, "usuario_actual", usuario)
    return TestClient(app)


def test_api_exige_sesion_y_permiso_global_antes_de_consultar(api, monkeypatch):
    llamadas = conectar(monkeypatch, respuestas())
    rutas = ["/api/flota/resumen", "/api/flota/vehiculos/0001PRB/recorrido?fecha=2026-11-02"]
    for ruta in rutas:
        assert api.get(ruta).status_code == 401
        assert api.get(ruta, headers={"Authorization": "Bearer invalido"}).status_code == 401
        assert api.get(ruta, headers={"Authorization": "Bearer chofer"}).status_code == 403
    assert llamadas == []
    r = api.get(rutas[0], headers={"Authorization": "Bearer gestor"})
    assert r.status_code == 200 and len(r.json()["vehiculos"]) == 5
    assert r.headers["cache-control"] == "no-store"
    assert api.get(rutas[1], headers={"Authorization": "Bearer gestor"}).status_code == 200
    assert api.get("/api/flota/vehiculos/OTRO/recorrido?fecha=2026-11-02", headers={"Authorization": "Bearer gestor"}).status_code == 404


def test_sesion_de_prueba_de_deca_no_abre_datos_reales(api, monkeypatch):
    monkeypatch.setattr(auth, "supabase_configurado", lambda: False)
    monkeypatch.setattr(auth, "get_settings", lambda: type("Config", (), {"mode": "mock"})())
    llamadas = conectar(monkeypatch, respuestas())
    assert api.get("/api/flota/resumen").status_code == 401
    assert llamadas == []


def test_chofer_solo_recibe_telemetria_de_su_asignacion_abierta(api, monkeypatch):
    from servicios import supa
    conectar(monkeypatch, respuestas())

    def leer(token, tabla, params):
        assert token == "chofer"
        if tabla == "vehiculos":
            return [{"id": 1, "matricula": "0001 PRB"}, {"id": 2, "matricula": "0002 PRB"}]
        assert tabla == "asignaciones" and params["usuario_id"] == "eq.u2" and params["fin"] == "is.null"
        return [{"vehiculo_id": 2}]

    monkeypatch.setattr(supa, "leer", leer)
    r = api.get("/api/chofer/hoy", headers={"Authorization": "Bearer chofer"})
    assert r.status_code == 200
    assert r.json()["vehiculo"]["matricula"] == "0002 PRB"
    assert "0001 PRB" not in r.text and "0003 PRB" not in r.text
    assert r.json()["tarjeta"] is None and r.json()["resumen"] is None


def test_chofer_sin_asignacion_no_consulta_movildata(api, monkeypatch):
    from servicios import supa
    llamadas = conectar(monkeypatch, respuestas())
    monkeypatch.setattr(supa, "leer", lambda *_: [])
    r = api.get("/api/chofer/hoy", headers={"Authorization": "Bearer chofer"})
    assert r.json()["vehiculo"] is None and r.json()["aviso"]
    assert llamadas == []


@pytest.mark.parametrize("envoltorio", ["texto", "Data", "Result", "unica"])
def test_respuestas_envueltas_o_como_texto_se_leen(monkeypatch, envoltorio):
    datos = respuestas()
    vehiculos = datos["/Users/GetVehiculos"]
    datos["/Users/GetVehiculos"] = {
        "texto": httpx.Response(200, json=json.dumps(vehiculos)),          # JSON codificado dos veces
        "Data": {"Data": vehiculos, "Total": 5},
        "Result": {"Result": vehiculos},
        "unica": {"Ok": True, "Coches": vehiculos},                         # el único campo que es lista
    }[envoltorio]
    conectar(monkeypatch, datos)
    r = movildata.resumen_flota()
    assert r["estado"] == "conectado" and len(r["vehiculos"]) == 5


def test_aviso_del_proveedor_se_explica_sin_mostrarlo(monkeypatch):
    conectar(monkeypatch, {"/Users/GetVehiculos": {"Message": "ApiKey clave-prueba-no-real no válida"}})
    r = movildata.resumen_flota()
    assert r["estado"] == "error" and "aviso en lugar de datos" in r["avisos"][0]
    assert "clave-prueba-no-real" not in json.dumps(r)


def test_forma_no_incluye_valores():
    f = movildata.forma([{"Matricula": "1234 ABC", "Imei": "secreto"}])
    assert "Matricula" in f and "1234" not in f and "secreto" not in f


def test_posiciones_como_las_manda_la_cuenta_real(monkeypatch):
    """Forma real de GetLastLocations: {"Results": {"Reg": [...]}} (y un solo registro sin lista)."""
    datos = respuestas()
    posiciones = datos["/Users/GetLastLocations"]
    datos["/Users/GetLastLocations"] = {"Results": {"Reg": posiciones}}
    conectar(monkeypatch, datos)
    r = movildata.resumen_flota()
    assert r["estado"] == "conectado" and r["vehiculos"][0]["latitud"] == 40.1
    movildata._cache.clear()
    datos["/Users/GetLastLocations"] = {"Results": {"Reg": posiciones[1]}}
    conectar(monkeypatch, datos)
    r = movildata.resumen_flota()
    assert r["vehiculos"][1]["latitud"] == 40.2 and r["vehiculos"][0]["latitud"] is None


def test_vehiculo_sin_matricula_asignada_en_movildata_se_explica(monkeypatch):
    datos = respuestas()
    datos["/Users/GetDataBetweenDates"] = httpx.Response(400, json={
        "Message": "Existen errores de validación",
        "Errors": ["dispositivo: La matrícula 0001 PRB no está asignada. Vaya a gestionar vehículos y asigne la matrícula"]})
    conectar(monkeypatch, datos)
    r = movildata.resumen_flota()
    assert r["vehiculos"][0]["km_hoy"] is None
    assert any("Gestionar vehículos" in a for a in r["vehiculos"][0]["avisos"])
    assert r["vehiculos"][0]["latitud"] == 40.1   # el resto de sus datos se ve igual


def test_fecha_en_formato_espanol_de_la_cuenta_real():
    assert movildata._fecha("05/11/2026 10:53:47") == "2026-11-05T09:53:47+00:00"   # noviembre: hora peninsular = UTC+1
    assert movildata._fecha("15/07/2026 10:00") == "2026-07-15T08:00:00+00:00"      # verano: UTC+2
    assert movildata._fecha("31/02/2026 10:00:00") is None
