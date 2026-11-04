"""Cliente Odoo con lista blanca. NO existe ninguna llamada genérica: cada operación permitida es un método fijo.

Lectura de tareas/bultos/mercancías/adjuntos; escritura SOLO de 4 campos en tms.package; message_post SOLO en project.task;
impresión SOLO del informe tms_reporting.tms_transportation_order.
"""
import json
import logging
import os
import re

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
    (ORDER_MODEL, "read_group"),        # solo vía ventas
    (INVOICE_MODEL, "read_group"),      # solo vía facturado y por_cobrar
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
]
ALLOWED_CALLS |= {(m, "check_access_rights") for m, _, _ in EXPECTED_PERMISSIONS}


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
    def _totales(self, model: str, domain: list, campo: str, agrupar: str = "company_id", sin_empresa: bool = False) -> list[dict]:
        empresa = ["|", ["company_id", "=", False], ["company_id", "in", self.s.company_ids]] if sin_empresa \
            else [["company_id", "in", self.s.company_ids]]
        filas = self._call(model, "read_group", [domain + empresa, [f"{campo}:sum"], [agrupar]], {"lazy": False})
        return [{"grupo": f[agrupar][1] if isinstance(f.get(agrupar), list) else "Sin asignar",
                 "n": int(f.get("__count") or 0), "importe": float(f.get(campo) or 0)} for f in filas]

    def crm_abiertas_por_etapa(self) -> list[dict]:
        """Oportunidades abiertas (ni ganadas ni perdidas) y su ingreso esperado, por etapa del embudo."""
        return self._totales(CRM_MODEL, [["type", "=", "opportunity"], ["active", "=", True], ["probability", "<", 100]],
                             "expected_revenue", "stage_id", sin_empresa=True)

    def crm_ganadas(self, desde: str) -> list[dict]:
        return self._totales(CRM_MODEL, [["type", "=", "opportunity"], ["probability", "=", 100], ["date_closed", ">=", desde]],
                             "expected_revenue", sin_empresa=True)

    def crm_nuevas(self, desde: str) -> list[dict]:
        return self._totales(CRM_MODEL, [["type", "=", "opportunity"], ["create_date", ">=", desde]], "expected_revenue", sin_empresa=True)

    def ventas(self, desde: str, hasta: str) -> list[dict]:
        """Pedidos de venta confirmados (base imponible) entre dos fechas, por empresa."""
        return self._totales(ORDER_MODEL, [["state", "in", ["sale", "done"]], ["date_order", ">=", desde], ["date_order", "<", hasta]],
                             "amount_untaxed")

    def facturado(self, desde: str, hasta: str) -> list[dict]:
        """Facturas y abonos de cliente publicados (base imponible, los abonos restan), por empresa."""
        return self._totales(INVOICE_MODEL, [["move_type", "in", ["out_invoice", "out_refund"]], ["state", "=", "posted"],
                                             ["invoice_date", ">=", desde], ["invoice_date", "<", hasta]], "amount_untaxed_signed")

    def por_cobrar(self, vencido_antes_de: str | None = None) -> list[dict]:
        """Importe pendiente de cobro de facturas de cliente publicadas; con fecha, solo lo ya vencido."""
        domain = [["move_type", "=", "out_invoice"], ["state", "=", "posted"], ["payment_state", "in", ["not_paid", "partial"]]]
        if vencido_antes_de:
            domain.append(["invoice_date_due", "<", vencido_antes_de])
        return self._totales(INVOICE_MODEL, domain, "amount_residual_signed")

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
