"""Movildata: qué camión tiene la tarjeta del tacógrafo de cada chófer y sus datos del día.

MOVILDATA_MODE=mock (por defecto): datos simulados y deterministas para probar la app.
MOVILDATA_MODE=real: pendiente de implementar con la documentación de la API de Movildata (endpoints de tarjeta,
actividad y posición). Mientras tanto responde «no disponible» y el chófer elige la matrícula a mano.
"""
from __future__ import annotations

import hashlib
import os
from datetime import datetime
from zoneinfo import ZoneInfo


def modo() -> str:
    return (os.environ.get("MOVILDATA_MODE") or "mock").strip().lower()


def tarjeta_en_camion(usuario_id: str, vehiculos: list[dict]) -> dict | None:
    """Vehículo en el que está ahora la tarjeta del chófer (o None si no hay tarjeta insertada)."""
    if modo() != "mock" or not vehiculos:
        return None
    n = int(hashlib.sha256(usuario_id.encode()).hexdigest(), 16)
    v = sorted(vehiculos, key=lambda x: x["id"])[n % len(vehiculos)]
    return {"vehiculo_id": v["id"], "matricula": v["matricula"], "desde": "06:42"}


def resumen_dia(usuario_id: str) -> dict | None:
    """Conducción, km y próxima pausa obligatoria del día (según la tarjeta)."""
    if modo() != "mock":
        return None
    ahora = datetime.now(ZoneInfo("Europe/Madrid"))
    horas = max(0.0, min(9.0, ahora.hour + ahora.minute / 60 - 6.7))
    conduccion = round(horas * 0.78, 2)
    seguida = round(conduccion % 4.5, 2)
    return {
        "conduccion_horas": conduccion,
        "km": int(conduccion * 71),
        "pausa_en_horas": round(max(0.0, 4.5 - seguida), 2),
        "limite_diario_horas": 9,
    }
