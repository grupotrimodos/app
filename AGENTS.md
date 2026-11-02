# Reglas del proyecto (Claude Code y Codex)

App interna de Grupo Trimodos. Leer `README.md` antes de cambiar nada.

## Stack
- Web: Next.js 16 (App Router, `src/`), TypeScript, CSS propio (`src/app/globals.css`). Next 16 usa `src/proxy.ts` (antes «middleware»).
- Login y datos: Supabase (`@supabase/ssr`). Permisos en la base de datos con RLS (`supabase/migrations/`).
- DECA y ARGON: API Python (FastAPI) en `servicios/`, publicada en Vercel con `api/index.py`. Rutas `/api/deca/*` y `/api/argon/*` (rewrites en `next.config.ts`).
- PWA de DECA: `public/deca/` (HTML/JS sin framework, funciona sin cobertura).

## Reglas
- Todo texto visible, en **español**, claro y no técnico. Botones grandes; pensado para móvil y cabina.
- **Secretos nunca en código ni en git** (`.env`, `.env.local`). La clave secreta de Supabase solo en servidor (`src/lib/supabase/admin.ts`, con `server-only`).
- Cambios de base de datos **solo con migraciones nuevas** en `supabase/migrations/` (nunca editar una ya aplicada). Toda tabla nueva con RLS activado y sus políticas.
- Toda ruta de API nueva exige sesión y módulo (`requiere_modulo` en Python). Un test comprueba que ninguna ruta de DECA queda abierta.
- Odoo: solo a través de la lista blanca de `servicios/odoo_client.py`. Nunca llamadas genéricas. **`DRY_RUN=true` por defecto**; producción v15 solo con el pedido S2621473 y permiso expreso.
- Al cambiar `public/deca/*`, subir la versión de `CACHE` en `public/deca/sw.js`.
- **Preguntar antes de `git push`** (el push despliega en Vercel).

## Comprobar antes de entregar
```bash
.venv/bin/python -m pytest -q
npx tsc --noEmit && npx next build
.venv/bin/python -X utf8 -m scripts.prueba_navegador     # si se toca DECA
```
