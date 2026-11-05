# Reglas del proyecto (única fuente para Claude Code y Codex)

App interna de Grupo Trimodos. Puesta en marcha en `README.md`; cómo funciona cada parte, en `docs/`. Léelo antes de
cambiar una función.

## Bases del proyecto

1. **Odoo es la base de datos principal y manda en el presente:** empleados, fichajes, vacaciones y su saldo, clientes,
   proveedores, viajes (tms), stock, facturas y vehículos. Lo que existe en Odoo se lee y se escribe en Odoo, sin copias
   que se editen.
2. **Movildata se consulta en directo** (posición, actividad, tacógrafo).
3. **Supabase guarda solo:**
   a) lo que no va a Odoo: login, perfiles, permisos, centros, enlace persona↔empleado de Odoo, ropa y EPIs,
      documentación, incidencias, inspecciones y la cola de envíos a Odoo;
   b) el histórico: fotos periódicas de Odoo y Movildata que solo se añaden y nunca se editan, con fecha y origen. Si un
      dato está mal se corrige en Odoo y la siguiente foto lo recoge.
   **Antes de crear una tabla en Supabase, comprueba si el dato ya existe en Odoo.**
4. **Acceso a Odoo:**
   - Leer: se permite consultar cualquier dato (`search_read`, `read`, `read_group`, `fields_get`).
   - Escribir: solo la lista cerrada actual de `ALLOWED_CALLS` y `EDITABLE_FIELDS` de `servicios/odoo_client.py`
     (fichajes, ausencias, notas y bultos/peso de DECA; DECA genera además el PDF de su orden con el informe
     `tms_reporting.tms_transportation_order`).
   - ARGON (`servicios/argon/`) tiene su propia lista, **congelada tal como está** (`PERMITIDO` en
     `argon_escritor.py`: pedidos de venta y contenedores, solo en el Odoo de pruebas salvo `ARGON_PERMITIR_PRODUCCION=1`).
     Es la segunda y última lista autorizada.
   - Borrar (`unlink`): nunca.
   - Nunca ampliar las escrituras sin permiso expreso de Félix; cualquier escritura nueva se propone antes, explicando
     qué toca. `tests/test_odoo_escrituras.py` falla si una de las dos listas crece, si aparece un borrado o si otro
     archivo habla con Odoo por su cuenta: no se arregla la prueba, se pide permiso.
   - Leer todo no es enseñar todo: cada pantalla y cada ruta filtra por los permisos de quien mira (nóminas, salarios y
     contabilidad nunca a quien no corresponda).
5. **Perfiles:** se configuran desde la app con los permisos de `src/lib/permisos.json`. Nunca hacer una página por
   perfil; una página por función, filtrada por permisos y centro.
6. **Fase actual: piloto de fichaje y vacaciones.** No añadir funciones nuevas; solo limpiar, arreglar y pulir. Lo demás
   queda oculto quitando el permiso en los perfiles, no borrando código.

## Stack
- Web: Next.js 16 (App Router, `src/`), TypeScript, CSS propio (`src/app/globals.css`, `src/app/shell.css`). Next 16 usa
  `src/proxy.ts` (antes «middleware»).
- Login y datos propios: Supabase (`@supabase/ssr`). Permisos en la base de datos con RLS (`supabase/migrations/`).
- API Python (FastAPI) en `servicios/`, publicada en Vercel con `api/index.py`: DECA, ARGON, fichajes y ausencias hacia
  Odoo, Movildata y finanzas de Odoo. Rutas `/api/deca|argon|rrhh|chofer|flota|odoo/*` (rewrites en `next.config.ts`).
- PWA de DECA: `public/deca/` (HTML/JS sin framework, funciona sin cobertura).

## Reglas
- Todo texto visible, en **español**, claro y no técnico. Botones grandes; pensado para móvil y cabina.
- **Secretos nunca en código ni en git** (`.env.local`). La clave secreta de Supabase solo en servidor
  (`src/lib/supabase/admin.ts` con `server-only`, y `servicios/supa.py` solo para anotar envíos a Odoo y la
  sincronización).
- Cambios de base de datos **solo con migraciones nuevas** en `supabase/migrations/` (nunca editar ni borrar una ya
  aplicada). Toda tabla nueva con RLS activado y sus políticas.
- **Permisos:** catálogo único en `src/lib/permisos.json`. Toda función nueva añade ahí sus permisos; páginas con
  `conPermiso(...)`, RLS con `privado.tengo_permiso` / `privado.puedo_sobre`, nunca roles fijos en el código.
- Toda ruta de API nueva exige sesión y permiso (`requiere_permiso` en Python). Un test comprueba que ninguna ruta queda
  abierta.
- Datos que deban llegar a Odoo: un mapa en `servicios/sincronizacion.py` (nunca envíos sueltos).
- Odoo: solo a través de `servicios/odoo_client.py` (y ARGON con su lista congelada). Nunca llamadas genéricas.
  **`DRY_RUN=true` por defecto**; producción v15 solo con el pedido S2621473 y permiso expreso.
- Al cambiar `public/deca/*`, subir la versión de `CACHE` en `public/deca/sw.js`.
- **Preguntar antes de `git push`** (el push despliega en Vercel).

## Comprobar antes de entregar
```bash
.venv/bin/python -m pytest -q
npx tsc --noEmit && npx next build
.venv/bin/python -X utf8 -m scripts.prueba_navegador     # si se toca DECA
```

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
