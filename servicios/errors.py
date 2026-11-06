class AppError(Exception):
    """Error con un mensaje claro para el conductor (en español, sin tecnicismos)."""

    def __init__(self, message: str, status: int = 400, code: str = "error"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


class OdooRechazo(AppError):
    """Odoo ha contestado con un error (p. ej. «no tiene días suficientes»). La pantalla ve un mensaje general; el motivo
    real de Odoo queda en `detalle` para guardarlo junto al registro y que la oficina sepa qué arreglar allí."""

    def __init__(self, detalle: str):
        super().__init__("El sistema no ha podido responder. Inténtalo de nuevo.", 502, "odoo_error")
        self.detalle = (detalle or "").strip()
