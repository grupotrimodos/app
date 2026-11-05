"""Cliente Odoo con lista blanca. NO existe ninguna llamada genérica: cada operación permitida es un método fijo.

Lectura de tareas/bultos/mercancías/adjuntos; escritura SOLO de 4 campos en tms.package; message_post SOLO en project.task;
impresión SOLO del informe tms_reporting.tms_transportation_order.
"""
import json
import logging
import os
import re
from datetime import date, timedelta

import httpx

from .config import Settings
from .errors import AppError

log = logging.getLogger("conductores")

ORDER_MODEL = "sale.order"
TASK_MODEL = "project.task"
PACKAGE_MODEL = "tms.package"
GOODS_MODEL = "tms.goods"
ATTACHMENT_MODEL = "ir.attachment"
ATTENDANCE_MODEL = "hr.attendance"   # fichajes
LEAVE_MODEL = "hr.leave"             # ausencias
LEAVE_TYPE_MODEL = "hr.leave.type"   # tipos de ausencia (se eligen solos por su nombre)
EMPLOYEE_MODEL = "hr.employee"       # enlazar cada persona de la app con su ficha de empleado
FLEET_MODEL = "fleet.vehicle"        # flota: se importan los camiones
MODULE_MODEL = "ir.module.module"    # qué aplicaciones de Odoo están instaladas (decide a dónde va cada dato)
CRM_MODEL = "crm.lead"              # cuadro de mando: oportunidades (solo totales)
INVOICE_MODEL = "account.move"      # cuadro de mando: facturado y pendiente de cobro (solo totales)
ORDER_LINE_MODEL = "sale.order.line"                # cuadro de mando: importe de pedidos pendiente de facturar (solo totales)
MOVE_LINE_MODEL = "account.move.line"               # cuadro de mando: ingresos y gastos por centro (analítica, solo totales)
ANALYTIC_ACCOUNT_MODEL = "account.analytic.account"  # catálogo de cuentas analíticas (para asignarlas a cada centro)
ANALYTIC_TAG_MODEL = "account.analytic.tag"          # catálogo de etiquetas analíticas (v15; desaparecen en v16+)

TASK_FIELDS = ["name", "company_id", "stage_id", "is_transport_order", "tms_package_ids", "tms_transport_order_attachment_id"]
PACKAGE_FIELDS = [
    "name", "carrier_tracking_ref", "goods_id", "number_of_packages", "euro_pallet_qty", "shipping_weight",
    "shipping_origin_id", "shipping_destination_id", "pickup_date", "forecast_unload_date", "state", "write_date",
]
ATTACHMENT_FIELDS = ["res_model", "res_id", "access_token", "name"]
EDITABLE_FIELDS = frozenset({"goods_id", "number_of_packages", "euro_pallet_qty", "shipping_weight"})
REPORT_NAME = "tms_reporting.tms_transportation_order"

# (modelo, método) permitidos. Todo lo demás se rechaza antes de salir hacia Odoo.
ALLOWED_CALLS = {
    (ORDER_MODEL, "search_read"),
    (TASK_MODEL, "read"),
    (TASK_MODEL, "search_read"),
    (TASK_MODEL, "fields_get"),
    (PACKAGE_MODEL, "read"),
    (PACKAGE_MODEL, "fields_get"),
    (GOODS_MODEL, "name_search"),
    (GOODS_MODEL, "read"),
    (ATTACHMENT_MODEL, "read"),
    ("res.company", "search_read"),
    ("ir.actions.report", "search_read"),   # solo vía find_report (diagnóstico)
    (PACKAGE_MODEL, "write"),        # solo vía write_package (campos EDITABLE_FIELDS)
    (TASK_MODEL, "message_post"),    # solo vía post_note
    (ATTENDANCE_MODEL, "search_read"),  # solo vía asistencia_abierta
    (ATTENDANCE_MODEL, "create"),       # solo vía abrir_asistencia (employee_id, check_in)
    (ATTENDANCE_MODEL, "write"),        # solo vía cerrar_asistencia (check_out)
    (LEAVE_MODEL, "create"),            # solo vía crear_ausencia
    # Lecturas de la sincronización automática (solo lectura)
    (LEAVE_TYPE_MODEL, "search_read"),  # solo vía tipos_ausencia
    (EMPLOYEE_MODEL, "search_read"),    # solo vía buscar_empleado
    (FLEET_MODEL, "search_read"),       # solo vía vehiculos_flota
    (MODULE_MODEL, "search_read"),      # solo vía modulos_instalados
    # Cuadro de mando de dirección: SOLO totales agrupados (read_group), nunca registros sueltos ni escrituras
    (CRM_MODEL, "read_group"),          # solo vía crm_*
    (ORDER_MODEL, "read_group"),        # solo vía ventas, ventas_por_mes y sin_facturar (nº de pedidos)
    (INVOICE_MODEL, "read_group"),      # solo vía facturado, por_cobrar, facturacion_por_mes, pendiente_por_vencimiento y principales_pendiente
    (ORDER_LINE_MODEL, "read_group"),   # solo vía sin_facturar (importe)
    (MOVE_LINE_MODEL, "read_group"),    # solo vía analitica_por_mes
    # Catálogo analítico para que la administración asigne cuentas/etiquetas a cada centro (solo id, nombre, código, empresa)
    (ANALYTIC_ACCOUNT_MODEL, "search_read"),   # solo vía cuentas_analiticas
    (ANALYTIC_TAG_MODEL, "search_read"),       # solo vía etiquetas_analiticas
}

# Permisos que se comprueban sin ejecutar nada: (modelo, operación, ¿debería tenerlo el usuario técnico?)
EXPECTED_PERMISSIONS = [
    (TASK_MODEL, "read", True), (TASK_MODEL, "write", True),       # write: necesario para publicar la nota (message_post)
    (TASK_MODEL, "unlink", False),
    (PACKAGE_MODEL, "read", True), (PACKAGE_MODEL, "write", True),
    (PACKAGE_MODEL, "create", False), (PACKAGE_MODEL, "unlink", False),
    (GOODS_MODEL, "read", True), (GOODS_MODEL, "write", False),
    (ATTACHMENT_MODEL, "read", True),
    (ORDER_MODEL, "read", True), (ORDER_MODEL, "write", False), (ORDER_MODEL, "unlink", False),
    (ATTENDANCE_MODEL, "read", True), (ATTENDANCE_MODEL, "create", True), (ATTENDANCE_MODEL, "write", True),
    (ATTENDANCE_MODEL, "unlink", False),
    (LEAVE_MODEL, "create", True), (LEAVE_MODEL, "unlink", False),
    (EMPLOYEE_MODEL, "read", True), (EMPLOYEE_MODEL, "write", False), (EMPLOYEE_MODEL, "unlink", False),
    (CRM_MODEL, "read", True), (INVOICE_MODEL, "read", True),   # cuadro de mando (solo lectura)
    (ORDER_LINE_MODEL, "read", True), (MOVE_LINE_MODEL, "read", True),                 # finanzas y centros (solo lectura)
    (ANALYTIC_ACCOUNT_MODEL, "read", True), (ANALYTIC_TAG_MODEL, "read", True),        # catálogo analítico (solo lectura)
]
ALLOWED_CALLS |= {(m, "check_access_rights") for m, _, _ in EXPECTED_PERMISSIONS}

# ---- cuadro de mando financiero: ayudas de dominio y lectura de grupos por fecha --------------------------------------
DIAS_DETALLE_VENCIMIENTO = 90   # los vencimientos de los últimos 90 días (y los futuros) llegan día a día; lo anterior, en total
_PEDIDO_CONFIRMADO = [["state", "in", ["sale", "done"]]]
_SIN_FACTURAR = _PEDIDO_CONFIRMADO + [["invoice_status", "=", "to invoice"]]
# tipo -> (modelo, dominio, campo de fecha, campo de importe, ¿la fecha es fecha y hora?)
_SERIES = {
    "facturacion": (INVOICE_MODEL, [["move_type", "in", ["out_invoice", "out_refund"]], ["state", "=", "posted"]],
                    "invoice_date", "amount_untaxed_signed", False),   # los abonos llegan en negativo: restan
    "ventas": (ORDER_MODEL, _PEDIDO_CONFIRMADO, "date_order", "amount_untaxed", True),
}
# Facturas publicadas sin cobrar/pagar del todo. amount_residual_signed es negativo en las de proveedor: se usa su valor absoluto.
_PENDIENTES = {
    "cobrar": [["move_type", "=", "out_invoice"], ["state", "=", "posted"], ["payment_state", "in", ["not_paid", "partial"]]],
    "pagar": [["move_type", "=", "in_invoice"], ["state", "=", "posted"], ["payment_state", "in", ["not_paid", "partial"]]],
}
# Para «principales»: la entidad comercial (la empresa) y no el contacto o la dirección de facturación concretos.
_PARTNER = "commercial_partner_id"


def _a_fecha(texto) -> date | None:
    """«AAAA-MM-DD» o «AAAA-MM-DD HH:MM:SS» → fecha. Si es una fecha y hora desplazada por la zona horaria (p. ej. el inicio
    de noviembre en Madrid llega como «2026-10-31 23:00:00» UTC), se redondea al día más cercano."""
    if not isinstance(texto, str) or len(texto) < 10:
        return None
    try:
        d = date.fromisoformat(texto[:10])
    except ValueError:
        return None
    if len(texto) >= 13 and texto[10] in " T" and texto[11:13].isdigit() and int(texto[11:13]) >= 12:
        d += timedelta(days=1)
    return d


def inicio_grupo(fila: dict, agrupar: str) -> date | None:
    """Primer día del grupo de un read_group por fecha («invoice_date:month», «date:day»…), SIN leer la etiqueta
    (viene traducida: «noviembre 2026»). v16+ trae «__range»; v15 solo «__domain», donde la primera condición «>=» sobre
    ese campo es la del grupo (Odoo pone primero el dominio del grupo). Además, los dominios de este cliente escriben
    «desde» como «> día anterior» (ver _desde), así que el único «>=» sobre el campo es siempre el del grupo."""
    campo = agrupar.split(":")[0]
    rango = fila.get("__range")
    if isinstance(rango, dict):
        r = rango.get(agrupar) or rango.get(campo)
        if isinstance(r, dict) and r.get("from"):
            return _a_fecha(r["from"])
    for hoja in fila.get("__domain") or []:
        if isinstance(hoja, (list, tuple)) and len(hoja) == 3 and hoja[0] == campo and hoja[1] == ">=":
            return _a_fecha(hoja[2])
    return None


def _desde(campo: str, d: date, fecha_hora: bool = False) -> list:
    """campo >= d, escrito como «> día anterior» (mismo resultado) para no confundirlo con el «>=» del grupo."""
    antes = d - timedelta(days=1)
    return [campo, ">", f"{antes.isoformat()} 23:59:59" if fecha_hora else antes.isoformat()]


def _hasta(campo: str, d: date, fecha_hora: bool = False) -> list:
    """campo < d (exclusivo). Las fechas y horas se comparan en UTC (el contexto no lleva zona horaria)."""
    return [campo, "<", f"{d.isoformat()} 00:00:00" if fecha_hora else d.isoformat()]


def _en_ventanas(campo: str, ventanas: list[tuple[date, date]], fecha_hora: bool = False) -> list:
    """Dominio «está en alguna de estas ventanas [desde, hasta)» en notación prefija de Odoo."""
    if not ventanas:
        raise ValueError("Hace falta al menos una ventana de fechas")
    dominio: list = ["|"] * (len(ventanas) - 1)
    for desde, hasta in ventanas:
        dominio += ["&", _desde(campo, desde, fecha_hora), _hasta(campo, hasta, fecha_hora)]
    return dominio


def dominio_analitico(cuentas: list[int], etiquetas: list[int]) -> list:
    """Apuntes de un centro: con alguna de sus cuentas analíticas O alguna de sus etiquetas (v15: analytic_account_id y
    analytic_tag_ids; en v16+ sería analytic_distribution). Vacío si el centro no tiene ninguna."""
    hojas = []
    if cuentas:
        hojas.append(["analytic_account_id", "in", sorted({int(i) for i in cuentas})])
    if etiquetas:
        hojas.append(["analytic_tag_ids", "in", sorted({int(i) for i in etiquetas})])
    return ["|", *hojas] if len(hojas) == 2 else hojas


def _m2o(valor) -> tuple[int | None, str]:
    return (valor[0], valor[1]) if isinstance(valor, (list, tuple)) and len(valor) == 2 else (None, "Sin asignar")


class OdooClient:
    def __init__(self, settings: Settings):
        self.s = settings
        self._uid: int | None = None
        self._http = httpx.Client(timeout=25)   # JSON-RPC y sesión web (informe)
        self._anon = httpx.Client(timeout=40)   # descarga por token, SIN cookies de sesión
        self._major_cache: int | None = None

    # ---- bajo nivel (privado) -------------------------------------------------
    def _rpc(self, service: str, method: str, args: list):
        payload = {"jsonrpc": "2.0", "method": "call", "params": {"service": service, "method": method, "args": args}, "id": 1}
        try:
            r = self._http.post(f"{self.s.odoo_url}/jsonrpc", json=payload)
            r.raise_for_status()
            data = r.json()
        except httpx.HTTPError:
            raise AppError("No hay conexión con el sistema. Inténtalo de nuevo.", 503, "sin_conexion")
        if "error" in data:
            raise AppError("El sistema no ha podido responder. Inténtalo de nuevo.", 502, "odoo_error")
        return data["result"]

    def _login(self) -> int:
        if self._uid is None:
            uid = self._rpc("common", "authenticate", [self.s.odoo_db, self.s.odoo_user, self.s.odoo_password, {}])
            if not uid:
                raise AppError("El sistema no ha aceptado el acceso. Avisa a la oficina.", 502, "login_odoo")
            self._uid = uid
        return self._uid

    def _call(self, model: str, method: str, args: list, kwargs: dict | None = None):
        if (model, method) not in ALLOWED_CALLS:
            raise PermissionError(f"Operación no permitida: {model}.{method}")
        kwargs = dict(kwargs or {})
        kwargs["context"] = {"allowed_company_ids": self.s.company_ids, "lang": "es_ES"}
        uid = self._login()
        return self._rpc("object", "execute_kw", [self.s.odoo_db, uid, self.s.odoo_password, model, method, args, kwargs])

    # ---- operaciones permitidas ----------------------------------------------
    def find_transport_tasks(self, order_name: str, company_id: int) -> list[dict]:
        orders = self._call(
            ORDER_MODEL, "search_read", [[["name", "=", order_name], ["company_id", "=", company_id]]],
            {"fields": ["tasks_ids"], "limit": 1},
        )
        if not orders or not orders[0]["tasks_ids"]:
            return []
        tasks = self._call(
            TASK_MODEL, "search_read",
            [[["id", "in", orders[0]["tasks_ids"]], "|", "|", ["is_transport_order", "=", True],
              ["tms_transport_order_attachment_id", "!=", False], ["tms_package_ids", "!=", False]]],
            {"fields": TASK_FIELDS, "order": "is_transport_order desc, id desc"},  # primero las marcadas, luego la más reciente
        )
        return tasks

    def read_task(self, task_id: int) -> dict | None:
        rows = self._call(TASK_MODEL, "read", [[task_id]], {"fields": TASK_FIELDS})
        return rows[0] if rows else None

    def read_packages(self, package_ids: list[int]) -> list[dict]:
        if not package_ids:
            return []
        return self._call(PACKAGE_MODEL, "read", [package_ids], {"fields": PACKAGE_FIELDS})

    def read_attachment(self, attachment_id: int) -> dict | None:
        rows = self._call(ATTACHMENT_MODEL, "read", [[attachment_id]], {"fields": ATTACHMENT_FIELDS})
        return rows[0] if rows else None

    def search_goods(self, query: str, limit: int = 10) -> list[dict]:
        limit = min(limit, 10)
        return [{"id": i, "name": n} for i, n in self._call(GOODS_MODEL, "name_search", [query], {"limit": limit})]

    # ---- escritura (solo lo imprescindible) ------------------------------------
    def write_package(self, package_id: int, values: dict) -> None:
        if not values or not set(values) <= EDITABLE_FIELDS:
            raise PermissionError("Campo no permitido")
        self._call(PACKAGE_MODEL, "write", [[int(package_id)], values])

    # ---- fichajes (hr.attendance) y ausencias (hr.leave) ------------------------
    # Fechas: Odoo guarda en UTC y por RPC las recibe como texto «AAAA-MM-DD HH:MM:SS».
    def asistencia_abierta(self, empleado_id: int) -> dict | None:
        rows = self._call(ATTENDANCE_MODEL, "search_read",
                          [[["employee_id", "=", int(empleado_id)], ["check_out", "=", False]]],
                          {"fields": ["id", "check_in"], "limit": 1, "order": "check_in desc"})
        return rows[0] if rows else None

    def abrir_asistencia(self, empleado_id: int, check_in: str) -> int:
        return self._call(ATTENDANCE_MODEL, "create", [{"employee_id": int(empleado_id), "check_in": check_in}])

    def cerrar_asistencia(self, asistencia_id: int, check_out: str) -> None:
        self._call(ATTENDANCE_MODEL, "write", [[int(asistencia_id)], {"check_out": check_out}])

    def crear_ausencia(self, empleado_id: int, tipo_id: int, desde: str, hasta: str, nombre: str) -> int:
        """Solicitud de ausencia en Odoo (queda para validar allí según su flujo)."""
        return self._call(LEAVE_MODEL, "create", [{
            "employee_id": int(empleado_id), "holiday_status_id": int(tipo_id),
            "request_date_from": desde, "request_date_to": hasta, "name": nombre[:120],
        }])

    # ---- lecturas para la sincronización automática -----------------------------
    def modulos_instalados(self, nombres: list[str]) -> set[str] | None:
        """Cuáles de estas aplicaciones están instaladas. None si el usuario de Odoo no puede consultarlo."""
        try:
            rows = self._call(MODULE_MODEL, "search_read", [[["name", "in", list(nombres)], ["state", "=", "installed"]]],
                              {"fields": ["name"]})
        except Exception:
            return None
        return {r["name"] for r in rows}

    # ---- cuadro de mando: solo totales por grupo (read_group), de las empresas configuradas --------------------
    # Todos aceptan `empresas`: restringe (nunca amplía) las empresas configuradas (ODOO_COMPANY_IDS).
    def _ids_empresa(self, empresas: list[int] | None = None) -> list[int]:
        ids = [int(i) for i in self.s.company_ids]
        if empresas is None:
            return ids
        pedidas = {int(e) for e in empresas}
        return [i for i in ids if i in pedidas]

    def _dominio_empresa(self, empresas: list[int] | None = None, sin_empresa: bool = False) -> list:
        """Empresas configuradas (o las pedidas de entre ellas). `sin_empresa`: también los registros sin empresa, pero solo
        cuando no se ha pedido una empresa concreta."""
        ids = self._ids_empresa(empresas)
        if sin_empresa and empresas is None:
            return ["|", ["company_id", "=", False], ["company_id", "in", ids]]
        return [["company_id", "in", ids]]

    def _agrupar(self, model: str, domain: list, campo: str, agrupar: str, **kwargs) -> list[dict]:
        return self._call(model, "read_group", [domain, [f"{campo}:sum"], [agrupar]], {"lazy": False, **kwargs})

    def _totales(self, model: str, domain: list, campo: str, agrupar: str = "company_id", sin_empresa: bool = False,
                 empresas: list[int] | None = None) -> list[dict]:
        filas = self._agrupar(model, domain + self._dominio_empresa(empresas, sin_empresa), campo, agrupar)
        return [{"grupo": f[agrupar][1] if isinstance(f.get(agrupar), list) else "Sin asignar",
                 "n": int(f.get("__count") or 0), "importe": float(f.get(campo) or 0)} for f in filas]

    def crm_abiertas_por_etapa(self, empresas: list[int] | None = None) -> list[dict]:
        """Oportunidades abiertas (ni ganadas ni perdidas) y su ingreso esperado, por etapa del embudo."""
        return self._totales(CRM_MODEL, [["type", "=", "opportunity"], ["active", "=", True], ["probability", "<", 100]],
                             "expected_revenue", "stage_id", sin_empresa=True, empresas=empresas)

    def crm_ganadas(self, desde: str, hasta: str | None = None, empresas: list[int] | None = None) -> list[dict]:
        domain = [["type", "=", "opportunity"], ["probability", "=", 100], ["date_closed", ">=", desde]]
        if hasta:
            domain.append(["date_closed", "<", hasta])
        return self._totales(CRM_MODEL, domain, "expected_revenue", sin_empresa=True, empresas=empresas)

    def crm_nuevas(self, desde: str, hasta: str | None = None, empresas: list[int] | None = None) -> list[dict]:
        domain = [["type", "=", "opportunity"], ["create_date", ">=", desde]]
        if hasta:
            domain.append(["create_date", "<", hasta])
        return self._totales(CRM_MODEL, domain, "expected_revenue", sin_empresa=True, empresas=empresas)

    def ventas(self, desde: str, hasta: str, empresas: list[int] | None = None) -> list[dict]:
        """Pedidos de venta confirmados (base imponible) entre dos fechas, por empresa."""
        return self._totales(ORDER_MODEL, [["state", "in", ["sale", "done"]], ["date_order", ">=", desde], ["date_order", "<", hasta]],
                             "amount_untaxed", empresas=empresas)

    def facturado(self, desde: str, hasta: str, empresas: list[int] | None = None) -> list[dict]:
        """Facturas y abonos de cliente publicados (base imponible, los abonos restan), por empresa."""
        return self._totales(INVOICE_MODEL, [["move_type", "in", ["out_invoice", "out_refund"]], ["state", "=", "posted"],
                                             ["invoice_date", ">=", desde], ["invoice_date", "<", hasta]], "amount_untaxed_signed",
                             empresas=empresas)

    def por_cobrar(self, vencido_antes_de: str | None = None, empresas: list[int] | None = None) -> list[dict]:
        """Importe pendiente de cobro de facturas de cliente publicadas; con fecha, solo lo ya vencido."""
        domain = [["move_type", "=", "out_invoice"], ["state", "=", "posted"], ["payment_state", "in", ["not_paid", "partial"]]]
        if vencido_antes_de:
            domain.append(["invoice_date_due", "<", vencido_antes_de])
        return self._totales(INVOICE_MODEL, domain, "amount_residual_signed", empresas=empresas)

    # ---- finanzas: series por mes, vencimientos, principales y pendiente de facturar (todo read_group) -------------
    def _por_mes(self, model: str, domain: list, fecha: str, importe: str, ventanas: list[tuple[date, date]],
                 empresas: list[int] | None, fecha_hora: bool = False, signo: float = 1.0) -> list[dict]:
        """Total por mes dentro de las ventanas [desde, hasta): [{mes: «AAAA-MM», importe, n}]. Si una ventana no cubre el
        mes entero, el grupo de ese mes trae solo esa parte (así varias ventanas parciales caben en una sola llamada)."""
        agrupar = f"{fecha}:month"
        filas = self._agrupar(model, domain + _en_ventanas(fecha, ventanas, fecha_hora) + self._dominio_empresa(empresas),
                              importe, agrupar)
        out = []
        for f in filas:
            inicio = inicio_grupo(f, agrupar)
            if inicio is not None:
                out.append({"mes": inicio.strftime("%Y-%m"), "importe": signo * float(f.get(importe) or 0),
                            "n": int(f.get("__count") or 0)})
        return out

    def _serie_por_mes(self, tipo: str, ventanas: list[tuple[date, date]], empresas: list[int] | None) -> list[dict]:
        model, domain, fecha, importe, fecha_hora = _SERIES[tipo]
        return self._por_mes(model, domain, fecha, importe, ventanas, empresas, fecha_hora)

    def facturacion_por_mes(self, ventanas: list[tuple[date, date]], empresas: list[int] | None = None) -> list[dict]:
        """Facturas y abonos de cliente publicados (base imponible en moneda de la empresa; los abonos restan), por mes de
        la fecha de factura."""
        return self._serie_por_mes("facturacion", ventanas, empresas)

    def ventas_por_mes(self, ventanas: list[tuple[date, date]], empresas: list[int] | None = None) -> list[dict]:
        """Pedidos de venta confirmados (base imponible), por mes de la fecha del pedido (en UTC)."""
        return self._serie_por_mes("ventas", ventanas, empresas)

    def pendiente_por_vencimiento(self, tipo: str, hoy: date, empresas: list[int] | None = None) -> dict:
        """Pendiente de cobro («cobrar») o de pago («pagar»): día a día desde hace DIAS_DETALLE_VENCIMIENTO días en adelante
        y, lo vencido antes, en un único total. Dos read_group. {dias: [{dia, importe, n}], antes: {importe, n}}."""
        base = _PENDIENTES[tipo] + self._dominio_empresa(empresas)
        desde = hoy - timedelta(days=DIAS_DETALLE_VENCIMIENTO)
        agrupar = "invoice_date_due:day"
        dias = []
        for f in self._agrupar(INVOICE_MODEL, base + [_desde("invoice_date_due", desde)], "amount_residual_signed", agrupar):
            d = inicio_grupo(f, agrupar)
            if d is not None:
                dias.append({"dia": d.isoformat(), "importe": abs(float(f.get("amount_residual_signed") or 0)),
                             "n": int(f.get("__count") or 0)})
        antes = self._agrupar(INVOICE_MODEL, base + [_hasta("invoice_date_due", desde)], "amount_residual_signed", "company_id")
        return {"dias": dias, "antes": {"importe": sum(abs(float(f.get("amount_residual_signed") or 0)) for f in antes),
                                        "n": sum(int(f.get("__count") or 0) for f in antes)}}

    def principales_pendiente(self, tipo: str, hoy: date, limite: int = 8, empresas: list[int] | None = None) -> list[dict]:
        """Clientes («cobrar») o proveedores («pagar») con más pendiente, ya ordenados y limitados por Odoo, con lo vencido
        de cada uno. Dos read_group. [{nombre, importe, vencido, n}]"""
        base = _PENDIENTES[tipo] + self._dominio_empresa(empresas)
        orden = "amount_residual_signed desc" if tipo == "cobrar" else "amount_residual_signed asc"   # proveedores: negativo
        filas = self._agrupar(INVOICE_MODEL, base, "amount_residual_signed", _PARTNER,
                              orderby=orden, limit=max(1, min(int(limite), 20)))
        ids = [i for i in (_m2o(f.get(_PARTNER))[0] for f in filas) if i is not None]
        vencido: dict[int, float] = {}
        if ids:
            for f in self._agrupar(INVOICE_MODEL, base + [[_PARTNER, "in", ids], _hasta("invoice_date_due", hoy)],
                                   "amount_residual_signed", _PARTNER):
                pid, _ = _m2o(f.get(_PARTNER))
                vencido[pid] = vencido.get(pid, 0.0) + abs(float(f.get("amount_residual_signed") or 0))
        out = []
        for f in filas:
            pid, nombre = _m2o(f.get(_PARTNER))
            out.append({"nombre": nombre, "importe": abs(float(f.get("amount_residual_signed") or 0)),
                        "vencido": vencido.get(pid, 0.0), "n": int(f.get("__count") or 0)})
        return out

    def sin_facturar(self, antes_de: date, empresas: list[int] | None = None) -> dict:
        """Pedidos confirmados con algo por facturar: importe (líneas, untaxed_amount_to_invoice) y nº de pedidos, en total y
        de los pedidos anteriores a `antes_de`. Cuatro read_group pequeños (por empresa) en lugar de agrupar por pedido: con
        miles de órdenes de transporte al año, agrupar por pedido devolvería miles de filas."""
        importe = self._totales(ORDER_LINE_MODEL, _SIN_FACTURAR, "untaxed_amount_to_invoice", empresas=empresas)
        importe_ant = self._totales(ORDER_LINE_MODEL, _SIN_FACTURAR + [_hasta("order_id.date_order", antes_de, fecha_hora=True)],
                                    "untaxed_amount_to_invoice", empresas=empresas)
        pedidos = self._totales(ORDER_MODEL, _SIN_FACTURAR, "amount_untaxed", empresas=empresas)
        antiguos = self._totales(ORDER_MODEL, _SIN_FACTURAR + [_hasta("date_order", antes_de, fecha_hora=True)],
                                 "amount_untaxed", empresas=empresas)
        return {"importe": sum(f["importe"] for f in importe), "pedidos": sum(f["n"] for f in pedidos),
                "antiguos": sum(f["n"] for f in antiguos), "importe_antiguo": sum(f["importe"] for f in importe_ant)}

    # ---- centros: ingresos y gastos por analítica (apuntes contables publicados) ---------------------------------
    def analitica_por_mes(self, grupo: str, cuentas: list[int], etiquetas: list[int], ventanas: list[tuple[date, date]],
                          empresas: list[int] | None = None) -> list[dict]:
        """Ingresos («income») o gastos («expense») por mes de los apuntes publicados con esas cuentas o etiquetas
        analíticas. Importe en positivo: los ingresos son saldo acreedor (balance negativo) y se cambian de signo."""
        if grupo not in ("income", "expense"):
            raise PermissionError(grupo)
        centro = dominio_analitico(cuentas, etiquetas)
        if not centro:
            return []
        domain = [["parent_state", "=", "posted"], ["account_id.internal_group", "=", grupo]] + centro
        return self._por_mes(MOVE_LINE_MODEL, domain, "date", "balance", ventanas, empresas,
                             signo=-1.0 if grupo == "income" else 1.0)

    def cuentas_analiticas(self, empresas: list[int] | None = None) -> list[dict]:
        """Cuentas analíticas activas de las empresas configuradas o sin empresa (máx. 500)."""
        ids = self._ids_empresa(empresas)
        filas = self._call(ANALYTIC_ACCOUNT_MODEL, "search_read",
                           [[["active", "=", True], "|", ["company_id", "=", False], ["company_id", "in", ids]]],
                           {"fields": ["id", "name", "code", "company_id"], "limit": 500, "order": "name"})
        return [{"id": f["id"], "nombre": f.get("name") or "", "codigo": f.get("code") or None,
                 "empresa": f["company_id"][1] if isinstance(f.get("company_id"), list) else None} for f in filas]

    def etiquetas_analiticas(self, empresas: list[int] | None = None) -> list[dict]:
        """Etiquetas analíticas de las empresas configuradas o sin empresa (máx. 500). Solo existen hasta Odoo 15."""
        ids = self._ids_empresa(empresas)
        filas = self._call(ANALYTIC_TAG_MODEL, "search_read", [["|", ["company_id", "=", False], ["company_id", "in", ids]]],
                           {"fields": ["id", "name"], "limit": 500, "order": "name"})
        return [{"id": f["id"], "nombre": f.get("name") or ""} for f in filas]

    def empresas_configuradas(self) -> list[dict]:
        """Nombre de cada empresa configurada, en el orden de ODOO_COMPANY_IDS."""
        ids = self._ids_empresa()
        filas = self._call("res.company", "search_read", [[["id", "in", ids]]], {"fields": ["name"]})
        nombres = {f["id"]: f.get("name") or "" for f in filas}
        return [{"id": i, "nombre": nombres.get(i) or f"Empresa {i}"} for i in ids]

    def buscar_empleado(self, correo: str | None = None, credencial: str | None = None) -> list[dict]:
        """Empleados activos con ese correo de trabajo o ese código de credencial (campo «barcode»).
        Con ODOO_CAMPO_CORREO (p. ej. «x_correo_app», un campo propio de la ficha), el correo se busca también ahí:
        sirve para quien entra con Google sin tocar el correo de trabajo."""
        if correo:   # =ilike sin comodines: «_» y «%» del correo se escapan
            literal = correo.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            dominio = [["work_email", "=ilike", literal]]
            extra = (os.environ.get("ODOO_CAMPO_CORREO") or "").strip()
            if re.fullmatch(r"x_[a-z0-9_]{1,60}|private_email", extra):   # solo un nombre de campo válido
                dominio = ["|", dominio[0], [extra, "=ilike", literal]]
        elif credencial:
            dominio = [["barcode", "=", credencial]]
        else:
            return []
        return self._call(EMPLOYEE_MODEL, "search_read", [dominio], {"fields": ["id", "name"], "limit": 2})

    def tipos_ausencia(self) -> list[dict]:
        return self._call(LEAVE_TYPE_MODEL, "search_read", [[]], {"fields": ["id", "name"]})

    def vehiculos_flota(self) -> list[dict]:
        rows = self._call(FLEET_MODEL, "search_read", [[["active", "=", True]]],
                          {"fields": ["id", "license_plate", "model_id"], "limit": 2000})
        return [{"id": r["id"], "matricula": r.get("license_plate") or "",
                 "modelo": (r.get("model_id") or [None, None])[1]} for r in rows]

    def _major(self) -> int:
        if self._major_cache is None:
            self._major_cache = int(self._rpc("common", "version", [])["server_version_info"][0])
        return self._major_cache

    def post_note(self, task_id: int, html_body: str) -> None:
        """Nota interna (sin avisar a seguidores) en la tarea."""
        kwargs = {"body": html_body, "message_type": "comment", "subtype_xmlid": "mail.mt_note"}
        if self._major() >= 18:
            # Odoo 18 escapa el cuerpo que llega por RPC (se vería el HTML escrito); hay que declararlo como HTML.
            kwargs["body_is_html"] = True
        self._call(TASK_MODEL, "message_post", [[int(task_id)]], kwargs)

    def print_order(self, task_id: int, company_id: int) -> dict:
        """Imprime la orden de transporte (Odoo crea un adjunto nuevo en la tarea) y devuelve ese adjunto."""
        fail = AppError("No se ha podido generar la orden de transporte. Inténtalo de nuevo.", 502, "pdf_fallo")
        try:
            r = self._http.post(f"{self.s.odoo_url}/web/session/authenticate", json={
                "jsonrpc": "2.0", "method": "call",
                "params": {"db": self.s.odoo_db, "login": self.s.odoo_user, "password": self.s.odoo_web_password}})
            res = r.json().get("result") or {}
            if not res.get("uid"):
                log.warning("print_order tarea=%s: la sesión web no se abrió (¿contraseña web, 2FA o clave API en lugar de contraseña?)", task_id)
                raise fail
            r = self._http.get(f"{self.s.odoo_url}/report/pdf/{REPORT_NAME}/{int(task_id)}",
                               params={"context": json.dumps({"allowed_company_ids": [int(company_id)]})}, timeout=90)
        except httpx.HTTPError as e:
            log.warning("print_order tarea=%s: error de red (%s)", task_id, type(e).__name__)
            raise fail
        if r.status_code != 200 or not r.content.startswith(b"%PDF"):
            log.warning("print_order tarea=%s: el informe devolvió HTTP %s (%s); 403 = el usuario no tiene permiso para imprimirlo",
                        task_id, r.status_code, r.headers.get("content-type"))
            raise fail
        task = self.read_task(task_id)
        att_ref = task and task.get("tms_transport_order_attachment_id")
        att = att_ref and self.read_attachment(att_ref[0])
        if not att:
            log.warning("print_order tarea=%s: se imprimió pero la tarea no tiene orden de transporte nueva", task_id)
            raise fail
        return att

    def check_web_login(self) -> bool:
        """Solo comprueba si las credenciales sirven para abrir una sesión web (lo que hace falta para imprimir). No imprime nada."""
        try:
            r = self._http.post(f"{self.s.odoo_url}/web/session/authenticate", json={
                "jsonrpc": "2.0", "method": "call",
                "params": {"db": self.s.odoo_db, "login": self.s.odoo_user, "password": self.s.odoo_web_password}})
            return bool((r.json().get("result") or {}).get("uid"))
        except (httpx.HTTPError, ValueError):
            return False

    def get_pdf(self, attachment_id: int, token: str) -> bytes | None:
        """Descarga el PDF con el access_token del adjunto (sin sesión: si el token no vale, Odoo lo rechaza)."""
        if not token:
            return None
        try:
            r = self._anon.get(f"{self.s.odoo_url}/web/content/{int(attachment_id)}",
                               params={"access_token": token, "download": "true"})
        except httpx.HTTPError:
            raise AppError("No hay conexión. Inténtalo de nuevo.", 503, "sin_conexion")
        return r.content if r.status_code == 200 and r.content.startswith(b"%PDF") else None

    def goods_name(self, goods_id: int) -> str | None:
        rows = self._call(GOODS_MODEL, "read", [[goods_id]], {"fields": ["name"]})
        return rows[0]["name"] if rows else None

    def check_permissions(self) -> list[tuple[str, str, bool, bool]]:
        """(modelo, operación, esperado, real). Solo consulta los derechos del usuario; no modifica nada."""
        return [(m, op, expected, bool(self._call(m, "check_access_rights", [op], {"raise_exception": False})))
                for m, op, expected in EXPECTED_PERMISSIONS]

    def find_report(self) -> list[dict]:
        """Diagnóstico: comprueba que existe el informe de la orden de transporte."""
        return self._call("ir.actions.report", "search_read", [[["report_name", "=", REPORT_NAME]]], {"fields": ["report_name", "model", "report_type"]})

    def server_version(self) -> str:
        return self._rpc("common", "version", [])["server_version"]

    def list_companies(self) -> list[dict]:
        return self._call("res.company", "search_read", [[]], {"fields": ["name"]})

    def describe_fields(self, model: str, filters: list[str]) -> dict:
        """Solo diagnóstico: lista campos (nombre, tipo, etiqueta) cuyo nombre contenga alguno de los filtros."""
        if model not in (TASK_MODEL, PACKAGE_MODEL):
            raise PermissionError(model)
        info = self._call(model, "fields_get", [], {"attributes": ["type", "string", "selection"]})
        return {k: v for k, v in info.items() if any(f in k for f in filters)}
