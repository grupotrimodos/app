# App de Grupo Trimodos

App interna para móvil y ordenador: login común y, según el perfil, fichaje y vacaciones (piloto actual), DECA y el
resto de funciones. **Odoo es la base de datos principal**; Supabase guarda el login, los perfiles y lo que no va a
Odoo. Reglas del proyecto: [`AGENTS.md`](AGENTS.md). Cómo funciona cada parte: [`docs/`](docs/README.md).

| Parte | Dónde |
|---|---|
| Web (Next.js 16) | `src/` |
| API Python (FastAPI): Odoo, Movildata, DECA y ARGON | `servicios/`, publicada con `api/index.py` |
| Login, perfiles y permisos (Supabase, RLS) | `supabase/migrations/` |
| PWA de DECA | `public/deca/` |
| Pruebas y utilidades | `tests/`, `scripts/` |

Todo se publica en **un solo proyecto de Vercel**: `https://app-two-omega-92.vercel.app`. Un `git push` a `main`
despliega (preguntar antes). La configuración que se hace una sola vez (Supabase, Microsoft, Google, Vercel) está en
[`docs/configuracion-inicial.md`](docs/configuracion-inicial.md).

## Arrancar en local (Mac y Windows)

1. Instalar **Node.js 22** y **Python 3.12 o superior**.
2. En la carpeta del proyecto:
   ```bash
   npm install
   python -m venv .venv
   .venv/bin/python -m pip install -r requirements-dev.txt      # Windows: .\.venv\Scripts\python.exe
   ```
3. Copiar `.env.example` como **`.env.local`** y rellenarlo. Lo leen la web y la API Python; **nunca se sube a git**.
   Lo que se deja vacío funciona en modo prueba (Odoo y Movildata simulados, `DRY_RUN=true`, `RRHH_DRY_RUN=true`).
4. Arrancar (activa antes el entorno: `source .venv/bin/activate`, o `.\.venv\Scripts\activate` en Windows):
   ```bash
   npm run dev        # web en http://localhost:3000 + API Python en el puerto 8000
   ```
   Sin las variables de Supabase solo funciona DECA en modo simulado (`http://localhost:3000/deca/`).

## Comprobar antes de entregar

```bash
.venv/bin/python -m pytest -q                              # API Python (los tests no leen .env.local)
npx tsc --noEmit && npx next build                         # web
.venv/bin/python -X utf8 -m scripts.prueba_navegador       # si se toca DECA (navegador real, arranca web y API)
```
