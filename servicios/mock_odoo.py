"""Odoo simulado con los mismos métodos que OdooClient. Datos basados en el pedido de prueba S2621473."""
import copy
import math
import uuid
from datetime import date, datetime, timedelta

from .pdf_sample import make_sample_pdf

TOKEN_ACTUAL = "11111111-aaaa-bbbb-cccc-000000000001"
TOKEN_ANTIGUO = "22222222-aaaa-bbbb-cccc-000000000002"

GOODS = [
    {"id": 1, "name": "Cereal a granel"},
    {"id": 2, "name": "Cartón y papel"},
    {"id": 3, "name": "Bebidas"},
    {"id": 4, "name": "Material de construcción"},
    {"id": 5, "name": "Productos químicos"},
]

# ---- cuadro de mando financiero (datos de ejemplo). Deterministas: dependen solo de las fechas pedidas, nunca del reloj.
EMPRESA_IDS = {1: "STINSA", 7: "TRANSARGI S.L.U"}
_REPARTO = {1: 0.72, 7: 0.28}                       # peso de cada empresa en lo que no se separa por empresa (CRM, analítica)
_FACTURACION_MES = {1: 1_060_000, 7: 400_000}       # €/mes medio de cada empresa
_TICKET = {1: 2_400, 7: 1_600}                      # importe medio de una factura o pedido
_ESTACIONALIDAD = (0.90, 0.94, 1.02, 1.00, 1.05, 1.04, 0.98, 0.88, 1.06, 1.12, 1.14, 0.96)   # agosto flojo, otoño fuerte
_PESO_DIA = (1.0, 1.0, 1.0, 1.0, 1.0, 0.25, 0.05)  # de lunes a domingo
_PESO_MES = 23.0                                    # suma de pesos de un mes típico

CLIENTES = ("Cerámicas del Mediterráneo, S.A.", "Azulejos Levante, S.L.", "Química del Grao, S.A.",
            "Fritas y Esmaltes de la Plana, S.L.", "Naviera Mare Nostrum, S.A.", "Cítricos de la Plana, S.L.",
            "Distribuciones Sevilla Sur, S.L.", "Aceites del Aljarafe, S.L.", "Materiales Burriana, S.A.",
            "Papelera del Mijares, S.L.")
PROVEEDORES = ("Gasóleos Levante, S.L.", "Neumáticos Castellón, S.L.", "Talleres Plana Diesel, S.L.",
               "Leasing Camiones Ibérica, S.A.", "Mutua de Seguros del Transporte", "Repuestos Industriales Burriana, S.L.",
               "Peajes y Servicios de Autopista, S.A.", "Lavaderos Industriales de Sevilla, S.L.", "Grúas y Montajes Vila-real, S.L.")
# (días desde hoy del vencimiento: mín, máx; peso del tramo). Casi todo sin vencer y algo en cada tramo de retraso.
_TRAMOS_ABIERTAS = ((0, 60, 0.60), (-30, -1, 0.20), (-60, -31, 0.10), (-90, -61, 0.06), (-240, -91, 0.04))
_ABIERTO = {"cobrar": {1: 2_350_000, 7: 780_000}, "pagar": {1: 1_150_000, 7: 410_000}}

CUENTAS_ANALITICAS = [
    {"id": 101, "nombre": "Grao de Castellón", "codigo": "GRAO", "empresa": "STINSA"},
    {"id": 102, "nombre": "Castellón de la Plana", "codigo": "CAST", "empresa": "STINSA"},
    {"id": 103, "nombre": "Burriana", "codigo": "BURR", "empresa": "STINSA"},
    {"id": 104, "nombre": "Sevilla", "codigo": "SEV", "empresa": "TRANSARGI S.L.U"},
    {"id": 105, "nombre": "Montaje Castellón", "codigo": "MCAS", "empresa": "STINSA"},
    {"id": 106, "nombre": "Montaje Burriana", "codigo": "MBUR", "empresa": "STINSA"},
    {"id": 107, "nombre": "Montaje Sevilla", "codigo": "MSEV", "empresa": "TRANSARGI S.L.U"},
    {"id": 108, "nombre": "Estructura y administración", "codigo": "ADM", "empresa": None},
]
ETIQUETAS_ANALITICAS = [
    {"id": 201, "nombre": "Contenedores Grao"}, {"id": 202, "nombre": "Grupaje"},
    {"id": 203, "nombre": "Internacional"}, {"id": 204, "nombre": "Viajes Sevilla"},
]


def _dias(ventanas):
    """Días (sin repetir) dentro de alguna ventana [desde, hasta)."""
    dias = set()
    for desde, hasta in ventanas:
        d = desde
        while d < hasta:
            dias.add(d)
            d += timedelta(days=1)
    return sorted(dias)


def _diario(nivel_mes: float, semilla: float, d: date) -> float:
    """Importe de ejemplo de un día: nivel mensual × estacionalidad × crecimiento (5 % anual) × día de la semana × ruido."""
    crecimiento = 1.05 ** ((d.year - 2026) + (d.month - 1) / 12)
    ruido_mes = 1 + 0.05 * math.sin((d.year * 12 + d.month) * 2.3 + semilla)
    ruido_dia = 1 + 0.12 * math.sin(d.toordinal() * 1.618 + semilla)
    return nivel_mes * _ESTACIONALIDAD[d.month - 1] * crecimiento * ruido_mes * ruido_dia * _PESO_DIA[d.weekday()] / _PESO_MES


def _por_mes(ventanas, importe_dia, ticket=None) -> list[dict]:
    """Agrupa por mes (como read_group «:month») los importes diarios de las ventanas pedidas."""
    meses: dict[str, list] = {}
    for d in _dias(ventanas):
        importe = importe_dia(d)
        m = meses.setdefault(d.strftime("%Y-%m"), [0.0, 0])
        m[0] += importe
        m[1] += round(abs(importe) / ticket) if ticket else 0
    return [{"mes": k, "importe": round(v[0], 2), "n": v[1]} for k, v in sorted(meses.items())]


class MockOdoo:
    def __init__(self):
        self.pdfs = {}
        self.writes, self.notes, self.prints = [], [], []  # registro de lo que se "escribe", para los tests
        self.asistencias: dict[int, dict] = {}   # id -> {employee_id, check_in, check_out}
        self.ausencias: dict[int, dict] = {}
        self.tasks = {
            204067: {
                "id": 204067, "name": "S2621473", "company_id": [7, "TRANSARGI S.L.U"], "stage_id": [7, "En desarrollo"],
                "is_transport_order": True, "tms_package_ids": [287102, 287103], "tms_transport_order_attachment_id": [900002, "Orden de transporte - S2621473 - 20260105101500.pdf"],
            },
            300001: {
                "id": 300001, "name": "CAMION COMPLETO FRANCIA", "company_id": [1, "STINSA"], "stage_id": [1, "Nuevo"],
                "is_transport_order": True, "tms_package_ids": [287103], "tms_transport_order_attachment_id": [900003, "Orden de transporte - S2621473 - 20260106090000.pdf"],
            },
            300002: {
                "id": 300002, "name": "ORDEN FACTURADA", "company_id": [7, "TRANSARGI, S.L.U"], "stage_id": [5, "Hecho"],
                "is_transport_order": True, "tms_package_ids": [287102], "tms_transport_order_attachment_id": [900004, "Orden de transporte - S2600001 - 20260101090000.pdf"],
            },
            300003: {   # como el pedido real S2621553: marca is_transport_order a False pero con su orden generada
                "id": 300003, "name": "T.I.- COMPLETO INTERNACIONAL", "company_id": [7, "TRANSARGI, S.L.U"], "stage_id": [7, "En desarrollo"],
                "is_transport_order": False, "tms_package_ids": [287102], "tms_transport_order_attachment_id": [900005, "Orden de transporte - S2621553 - 20261016151726.pdf"],
            },
            300004: {   # tarea normal del pedido: ni marcada ni con orden de transporte
                "id": 300004, "name": "TAREA INTERNA", "company_id": [7, "TRANSARGI, S.L.U"], "stage_id": [1, "Nuevo"],
                "is_transport_order": False, "tms_package_ids": [], "tms_transport_order_attachment_id": False,
            },
            300005: {   # como las órdenes de contenedor reales: orden de transporte generada pero SIN bultos
                "id": 300005, "name": "ST TRANSPORTE CONTENEDOR", "company_id": [1, "STINSA"], "stage_id": [1, "Nuevo"],
                "is_transport_order": False, "tms_package_ids": [], "tms_transport_order_attachment_id": [900006, "Orden de transporte - S26099887 - 20261019152033.pdf"],
            },
        }
        # (pedido, id de compañía) -> tareas: el mismo número puede existir en STINSA y en TRANSARGI
        self.orders = {("S2621473", 7): [204067], ("S2621473", 1): [300001], ("S2600001", 7): [300002], ("S2621553", 7): [300003, 300004], ("S26099887", 1): [300005]}
        self.packages = {
            287102: {
                "id": 287102, "name": "PK2627486", "carrier_tracking_ref": "REF-0042", "goods_id": [2, "Cartón y papel"],
                "number_of_packages": 12, "euro_pallet_qty": 10, "shipping_weight": 8450.0,
                "shipping_origin_id": [11, "Almacén Zaragoza"], "shipping_destination_id": [12, "Fábrica Valencia"],
                "pickup_date": "2026-01-06 07:00:00", "forecast_unload_date": "2026-01-06 16:00:00", "state": "draft",
                "write_date": "2026-01-05 10:15:00",
            },
            287103: {
                "id": 287103, "name": "PK2627487", "carrier_tracking_ref": "REF-0043", "goods_id": [3, "Bebidas"],
                "number_of_packages": 4, "euro_pallet_qty": 4, "shipping_weight": 3200.0,
                "shipping_origin_id": [11, "Almacén Zaragoza"], "shipping_destination_id": [13, "Centro logístico Madrid"],
                "pickup_date": "2026-01-06 07:00:00", "forecast_unload_date": "2026-01-06 19:00:00", "state": "draft",
                "write_date": "2026-01-05 10:15:00",
            },
        }
        self.attachments = {
            900002: {"id": 900002, "res_model": "project.task", "res_id": 204067, "access_token": TOKEN_ACTUAL, "name": "Orden de transporte - S2621473 - 20260105101500.pdf"},
            900003: {"id": 900003, "res_model": "project.task", "res_id": 300001, "access_token": "33333333-aaaa-bbbb-cccc-000000000003", "name": "Orden de transporte - S2621473 - 20260106090000.pdf"},
            900004: {"id": 900004, "res_model": "project.task", "res_id": 300002, "access_token": "44444444-aaaa-bbbb-cccc-000000000004", "name": "Orden de transporte - S2600001 - 20260101090000.pdf"},
            900005: {"id": 900005, "res_model": "project.task", "res_id": 300003, "access_token": "55555555-aaaa-bbbb-cccc-000000000005", "name": "Orden de transporte - S2621553 - 20261016151726.pdf"},
            900006: {"id": 900006, "res_model": "project.task", "res_id": 300005, "access_token": "66666666-aaaa-bbbb-cccc-000000000006", "name": "Orden de transporte - S26099887 - 20261019152033.pdf"},
            900001: {"id": 900001, "res_model": "project.task", "res_id": 204067, "access_token": TOKEN_ANTIGUO, "name": "Orden antigua"},
        }

    def find_transport_tasks(self, order_name, company_id):
        ids = sorted(self.orders.get((order_name, company_id), []), reverse=True)
        keep = [i for i in ids if self.tasks[i]["is_transport_order"] or self.tasks[i]["tms_transport_order_attachment_id"] or self.tasks[i]["tms_package_ids"]]  # mismo filtro que Odoo
        keep.sort(key=lambda i: not self.tasks[i]["is_transport_order"])  # marcadas primero (orden estable: la más reciente antes)
        return [copy.deepcopy(self.tasks[i]) for i in keep]

    def read_task(self, task_id):
        return copy.deepcopy(self.tasks.get(task_id))

    def read_packages(self, package_ids):
        return [copy.deepcopy(self.packages[i]) for i in package_ids if i in self.packages]

    def read_attachment(self, attachment_id):
        return copy.deepcopy(self.attachments.get(attachment_id))

    def search_goods(self, query, limit=10):
        q = (query or "").lower()
        return [g for g in GOODS if q in g["name"].lower()][: min(limit, 10)]

    def goods_name(self, goods_id):
        return next((g["name"] for g in GOODS if g["id"] == goods_id), None)

    def write_package(self, package_id, values):
        pkg = self.packages[package_id]
        for k, v in values.items():
            pkg[k] = ([v, self.goods_name(v)] if v else False) if k == "goods_id" else v
        pkg["write_date"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.writes.append((package_id, dict(values)))

    # ---- fichajes y ausencias
    def asistencia_abierta(self, empleado_id):
        abiertas = [{"id": i, "check_in": a["check_in"]} for i, a in self.asistencias.items()
                    if a["employee_id"] == empleado_id and not a["check_out"]]
        return max(abiertas, key=lambda a: a["check_in"]) if abiertas else None

    def abrir_asistencia(self, empleado_id, check_in):
        if self.asistencia_abierta(empleado_id):   # Odoo tampoco deja dos entradas abiertas
            raise ValueError("Ya hay una entrada abierta")
        i = 700000 + len(self.asistencias) + 1
        self.asistencias[i] = {"employee_id": empleado_id, "check_in": check_in, "check_out": None}
        return i

    def cerrar_asistencia(self, asistencia_id, check_out):
        a = self.asistencias[asistencia_id]
        if check_out <= a["check_in"]:
            raise ValueError("La salida no puede ser anterior a la entrada")
        a["check_out"] = check_out

    def crear_ausencia(self, empleado_id, tipo_id, desde, hasta, nombre):
        i = 800000 + len(self.ausencias) + 1
        self.ausencias[i] = {"employee_id": empleado_id, "tipo_id": tipo_id, "desde": desde, "hasta": hasta, "nombre": nombre}
        return i

    # ---- lecturas de la sincronización automática
    instalados = {"hr", "hr_attendance", "hr_holidays", "fleet", "crm", "sale", "account"}
    empleados = [{"id": 41, "name": "Ana Conductora", "work_email": "ana@grupotrimodos.com", "barcode": "C001"},
                 {"id": 7, "name": "Jefa de tráfico", "work_email": "jefa@grupotrimodos.com", "barcode": None}]

    # ---- cuadro de mando (datos de ejemplo: en pantalla se marcan como de prueba) ----
    EMPRESAS = ("STINSA", "TRANSARGI S.L.U")
    company_ids = (1, 7)   # como ODOO_COMPANY_IDS por defecto

    def _ids(self, empresas=None):
        """Igual que OdooClient: `empresas` restringe, nunca amplía."""
        return [i for i in self.company_ids if empresas is None or i in {int(e) for e in empresas}]

    def _por_empresa(self, importes, cuentas, empresas=None):
        ids = self._ids(empresas)
        return [{"grupo": e, "n": n, "importe": float(i)}
                for cid, e, i, n in zip(self.company_ids, self.EMPRESAS, importes, cuentas) if cid in ids]

    def crm_abiertas_por_etapa(self, empresas=None):
        parte = 1.0 if empresas is None else sum(_REPARTO[i] for i in self._ids(empresas))
        return [{"grupo": g, "n": round(n * parte), "importe": round(i * parte, 2)} for g, n, i in
                (("Nueva", 14, 86000), ("Calificada", 9, 124500), ("Propuesta", 6, 98200), ("Negociación", 3, 61000))]

    def crm_ganadas(self, desde, hasta=None, empresas=None):
        if hasta:   # periodo anterior (del 1 al mismo día del mes pasado)
            return self._por_empresa((36100, 15200), (3, 1), empresas)
        return self._por_empresa((42300, 18750), (3, 2), empresas)

    def crm_nuevas(self, desde, hasta=None, empresas=None):
        if hasta:
            return self._por_empresa((44800, 19900), (6, 3), empresas)
        return self._por_empresa((51000, 23400), (7, 4), empresas)

    def ventas(self, desde, hasta, empresas=None):
        return self._por_empresa((312450.5, 148900), (61, 37), empresas)

    def facturado(self, desde, hasta, empresas=None):
        return self._por_empresa((287300, 139420.75), (54, 33), empresas)

    def por_cobrar(self, vencido_antes_de=None, empresas=None):
        if vencido_antes_de:
            return self._por_empresa((48200, 21950), (12, 6), empresas)
        return self._por_empresa((196400, 88730), (71, 40), empresas)

    # ---- finanzas (mismos métodos y formas que OdooClient) ----
    def empresas_configuradas(self):
        return [{"id": i, "nombre": EMPRESA_IDS[i]} for i in self.company_ids]

    def _serie(self, factor, semilla, ventanas, empresas):
        ids = self._ids(empresas)
        filas: dict[str, dict] = {}
        for cid in ids:
            nivel = _FACTURACION_MES[cid] * factor
            for f in _por_mes(ventanas, lambda d: _diario(nivel, semilla + cid, d), _TICKET[cid]):
                m = filas.setdefault(f["mes"], {"mes": f["mes"], "importe": 0.0, "n": 0})
                m["importe"] = round(m["importe"] + f["importe"], 2)
                m["n"] += f["n"]
        return [filas[k] for k in sorted(filas)]

    def facturacion_por_mes(self, ventanas, empresas=None):
        return self._serie(1.0, 0.0, ventanas, empresas)

    def ventas_por_mes(self, ventanas, empresas=None):
        return self._serie(1.03, 0.7, ventanas, empresas)   # algo más que lo facturado: hay pedidos sin facturar

    def _abiertas(self, tipo, hoy, empresas):
        """Facturas de ejemplo sin cobrar («cobrar») o sin pagar («pagar»), con vencimientos relativos a `hoy`."""
        nombres = CLIENTES if tipo == "cobrar" else PROVEEDORES
        out = []
        for cid in self._ids(empresas):
            k = 0
            for lo, hi, peso in _TRAMOS_ABIERTAS:
                n = max(3, int(40 * peso))
                for j in range(n):
                    k += 1
                    dias = lo + (j * 7 + cid) % (hi - lo + 1)
                    importe = _ABIERTO[tipo][cid] * peso / n * (0.6 + 0.08 * ((j * 37 + cid) % 11)) \
                        * (1 + ((j * 53 + cid * 11) % 97) / 1000)
                    out.append({"empresa": cid, "nombre": nombres[(k * 7 + cid) % len(nombres)],   # 7: recorre todos
                                "vence": hoy + timedelta(days=dias), "importe": round(importe, 2)})
        return out

    def pendiente_por_vencimiento(self, tipo, hoy, empresas=None):
        desde = hoy - timedelta(days=90)
        dias: dict[str, dict] = {}
        antes = {"importe": 0.0, "n": 0}
        for f in self._abiertas(tipo, hoy, empresas):
            if f["vence"] >= desde:
                g = dias.setdefault(f["vence"].isoformat(), {"dia": f["vence"].isoformat(), "importe": 0.0, "n": 0})
            else:
                g = antes
            g["importe"] = round(g["importe"] + f["importe"], 2)
            g["n"] += 1
        return {"dias": [dias[k] for k in sorted(dias)], "antes": antes}

    def principales_pendiente(self, tipo, hoy, limite=8, empresas=None):
        por: dict[str, dict] = {}
        for f in self._abiertas(tipo, hoy, empresas):
            p = por.setdefault(f["nombre"], {"nombre": f["nombre"], "importe": 0.0, "vencido": 0.0, "n": 0})
            p["importe"] = round(p["importe"] + f["importe"], 2)
            p["n"] += 1
            if f["vence"] < hoy:
                p["vencido"] = round(p["vencido"] + f["importe"], 2)
        return sorted(por.values(), key=lambda p: -p["importe"])[:limite]

    def sin_facturar(self, antes_de, empresas=None):
        datos = {1: (184_350.40, 63, 9, 27_480.00), 7: (61_920.75, 24, 4, 11_305.50)}
        ids = self._ids(empresas)
        return {"importe": round(sum(datos[i][0] for i in ids), 2), "pedidos": sum(datos[i][1] for i in ids),
                "antiguos": sum(datos[i][2] for i in ids), "importe_antiguo": round(sum(datos[i][3] for i in ids), 2)}

    # ---- centros (analítica): importes deterministas según el id de la cuenta o etiqueta
    @staticmethod
    def _nivel_analitico(grupo, odoo_id, es_etiqueta):
        ingresos = (12_000 + (odoo_id * 3571) % 30_000) if es_etiqueta else (70_000 + (odoo_id * 7919) % 150_000)
        if grupo == "income":
            return ingresos
        return ingresos * ((0.85 + (odoo_id % 3) * 0.04) if es_etiqueta else (0.80 + (odoo_id % 5) * 0.03))

    def analitica_por_mes(self, grupo, cuentas, etiquetas, ventanas, empresas=None):
        if grupo not in ("income", "expense"):
            raise PermissionError(grupo)
        if not cuentas and not etiquetas:
            return []
        parte = sum(_REPARTO[i] for i in self._ids(empresas))
        fuentes = [(self._nivel_analitico(grupo, i, False) * parte, i) for i in sorted(set(cuentas))]
        fuentes += [(self._nivel_analitico(grupo, i, True) * parte, i) for i in sorted(set(etiquetas))]
        semilla = 0.0 if grupo == "income" else 1.3   # los gastos no siguen día a día a los ingresos

        def importe_dia(d):
            return sum(_diario(nivel, i + semilla, d) for nivel, i in fuentes)

        return _por_mes(ventanas, importe_dia, ticket=900)

    def cuentas_analiticas(self, empresas=None):
        nombres = {EMPRESA_IDS[i] for i in self._ids(empresas)}
        return [dict(c) for c in CUENTAS_ANALITICAS if c["empresa"] is None or c["empresa"] in nombres]

    def etiquetas_analiticas(self, empresas=None):
        return [dict(e) for e in ETIQUETAS_ANALITICAS]

    def modulos_instalados(self, nombres):
        return {n for n in nombres if n in self.instalados}

    def buscar_empleado(self, correo=None, credencial=None):
        if correo:
            hay = [e for e in self.empleados if (e["work_email"] or "").lower() == correo.lower()]
        elif credencial:
            hay = [e for e in self.empleados if e["barcode"] == credencial]
        else:
            hay = []
        return [{"id": e["id"], "name": e["name"]} for e in hay][:2]

    def tipos_ausencia(self):
        return [{"id": 1, "name": "Vacaciones"}, {"id": 2, "name": "Baja por enfermedad"},
                {"id": 3, "name": "Asuntos propios"}, {"id": 4, "name": "Permiso no retribuido"}]

    def vehiculos_flota(self):
        return [{"id": 501, "matricula": "4521 LKM", "modelo": "Volvo FH 500"},
                {"id": 502, "matricula": "9910 NBC", "modelo": "Scania R 450"}]

    def post_note(self, task_id, html_body):
        self.notes.append((task_id, html_body))

    def _sample_pdf(self, task_id, stamp):
        task = self.tasks[task_id]
        lines = ["*** DOCUMENTO DE MUESTRA - SIMULACION, NO ES UNA ORDEN REAL ***", f"Generado: {stamp}", ""]
        for p in (self.packages[i] for i in task["tms_package_ids"]):
            lines += [
                f"{p['name']}: {p['shipping_origin_id'][1]} -> {p['shipping_destination_id'][1]}",
                f"   Mercancia: {(p['goods_id'] or [0, '-'])[1]}   Elementos: {p['number_of_packages']}   Euro: {p['euro_pallet_qty']}   Peso: {p['shipping_weight']:,.0f} kg",
                "",
            ]
        return make_sample_pdf(f"Orden de transporte {task['name']}", lines)

    def print_order(self, task_id, company_id):
        """Como Odoo: cada impresión crea un adjunto nuevo y lo deja como el actual de la tarea."""
        att_id = max(self.attachments) + 1
        stamp = datetime.now().strftime("%Y%m%d%H%M%S")
        name = f"Orden de transporte - SIMULACION - {stamp}.pdf"
        att = {"id": att_id, "res_model": "project.task", "res_id": task_id, "access_token": str(uuid.uuid4()), "name": name}
        self.attachments[att_id] = att
        self.tasks[task_id]["tms_transport_order_attachment_id"] = [att_id, name]
        self.pdfs[att_id] = self._sample_pdf(task_id, stamp)
        self.prints.append(task_id)
        return copy.deepcopy(att)

    def get_pdf(self, attachment_id, token):
        att = self.attachments.get(attachment_id)
        if not att or att["access_token"] != token:
            return None
        if attachment_id not in self.pdfs:  # adjuntos de ejemplo: se genera una muestra con los datos actuales
            self.pdfs[attachment_id] = self._sample_pdf(att["res_id"], "(adjunto existente)")
        return self.pdfs[attachment_id]