import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# En local, la API lee .env y el mismo .env.local que la web (lo que ya esté en el entorno o en .env manda).
# ENV_FILE permite apuntar a otro archivo (p. ej. ENV_FILE=.env.odoo18); los tests lo fijan a «ninguno».
# En Vercel no hay archivos: todo llega del entorno.
_RAIZ = Path(__file__).resolve().parent.parent
if os.environ.get("ENV_FILE"):
    load_dotenv(os.environ["ENV_FILE"])
else:
    load_dotenv(_RAIZ / ".env")
    load_dotenv(_RAIZ / ".env.local")


def _bool(value: str | None, default: bool) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "si", "sí")


@dataclass(frozen=True)
class Settings:
    mode: str
    dry_run: bool
    odoo_url: str
    odoo_db: str
    odoo_user: str
    odoo_password: str
    odoo_web_password: str   # solo para imprimir el PDF (sesión web); si está vacía se usa odoo_password
    company_ids: list[int]
    secret_key: str
    qr_allowed_hosts: list[str]
    editable_stages: list[str]   # etapas de la tarea en las que se puede modificar
    weight_warning_kg: float     # a partir de este peso (kg) la app pide confirmar (posible exceso de la MMA)


def get_settings() -> Settings:
    """Lee el entorno cada vez (barato) para que los tests puedan cambiarlo."""
    mode = os.environ.get("ODOO_MODE", "mock").strip().lower()
    secret = os.environ.get("SECRET_KEY", "")
    if not secret:
        if mode == "real":
            raise RuntimeError("Falta SECRET_KEY en el entorno (.env).")
        secret = "clave-solo-para-desarrollo"
    return Settings(
        mode=mode,
        dry_run=_bool(os.environ.get("DRY_RUN"), True),
        odoo_url=os.environ.get("ODOO_URL", "").rstrip("/"),
        odoo_db=os.environ.get("ODOO_DB", ""),
        odoo_user=os.environ.get("ODOO_USER", ""),
        odoo_password=os.environ.get("ODOO_PASSWORD", ""),
        odoo_web_password=os.environ.get("ODOO_WEB_PASSWORD", "") or os.environ.get("ODOO_PASSWORD", ""),
        company_ids=[int(x) for x in os.environ.get("ODOO_COMPANY_IDS", "1,7").split(",") if x.strip()],
        secret_key=secret,
        qr_allowed_hosts=[h.strip().lower() for h in os.environ.get("QR_ALLOWED_HOSTS", "").split(",") if h.strip()],
        weight_warning_kg=float((os.environ.get("PESO_AVISO_KG", "") or "27000").replace(",", ".")),
        editable_stages=[x.strip() for x in os.environ.get("EDITABLE_STAGES", "nuevo,en desarrollo").split(",") if x.strip()],
    )
