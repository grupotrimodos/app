"""Los tests nunca leen los archivos de entorno del ordenador (.env, .env.local): con claves reales podrían llegar a
Odoo o a Movildata. Cada test pone lo que necesita."""
import os

os.environ["ENV_FILE"] = os.devnull
