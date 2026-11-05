"""Diagnóstico de Movildata: la FORMA de cada respuesta (tipo, cuántos y nombres de campos) y si la app la sabe leer.

No enseña ningún dato de los vehículos ni la clave. Solo lee: las mismas consultas que la app.
Uso (con MOVILDATA_API_KEY en el entorno, en .env.local o en .env):
    Mac:      .venv/bin/python -X utf8 -m scripts.diagnostico_movildata
    Windows:  .\\.venv\\Scripts\\python.exe -X utf8 -m scripts.diagnostico_movildata
"""
import json
import os
from pathlib import Path

import httpx

from servicios import movildata

RAIZ = Path(__file__).resolve().parent.parent


def clave() -> str:
    if os.environ.get("MOVILDATA_API_KEY"):
        return os.environ["MOVILDATA_API_KEY"].strip()
    for nombre in (".env.local", ".env"):
        archivo = RAIZ / nombre
        if archivo.exists():
            for linea in archivo.read_text(encoding="utf-8").splitlines():
                if linea.startswith("MOVILDATA_API_KEY="):
                    return linea.partition("=")[2].strip()
    return ""


def main() -> None:
    k = clave()
    if not k:
        print("Falta MOVILDATA_API_KEY (en el entorno, en .env.local o en .env).")
        return
    with httpx.Client(timeout=15, follow_redirects=False) as http:
        for ruta in ("Users/GetVehiculos", "Users/GetLastLocations", "InfoEco/GetLastConsumptions"):
            try:
                r = http.get(f"{movildata.BASE_URL}/{ruta}", params={"apikey": k}, headers={"Accept": "application/json"})
            except httpx.HTTPError as e:
                print(f"{ruta}: sin conexión ({type(e).__name__})")
                continue
            tipo = r.headers.get("content-type", "?")
            try:
                datos = r.json()
                texto = isinstance(datos, str)
                if texto:
                    datos = json.loads(datos)
            except ValueError:
                print(f"{ruta}: HTTP {r.status_code} · {tipo} · no es JSON ({len(r.content)} bytes)")
                continue
            try:
                n = len(movildata._lista(datos, objeto=ruta.endswith("Consumptions")))
                lectura = f"la app la lee: {n} registros"
            except movildata.MovildataError as e:
                lectura = f"la app NO la lee: {e}"
            print(f"{ruta}: HTTP {r.status_code} · {tipo}{' · JSON dentro de un texto' if texto else ''}\n"
                  f"   forma: {movildata.forma(datos)}\n   {lectura}")


if __name__ == "__main__":
    main()
