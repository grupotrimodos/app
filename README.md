# App de Grupo Trimodos

App interna para móvil y ordenador. Una sola web (Next.js) con login común y módulos según el perfil de cada persona.

| Parte | Qué es | Dónde |
|---|---|---|
| App general | Login (Microsoft para oficina; código + PIN para conductores y operarios), inicio con los módulos de cada uno y administración de usuarios, centros y roles | `src/` (Next.js) |
| Base de datos y login | Supabase (PostgreSQL + Auth). Los permisos están en la base de datos (RLS) | `supabase/migrations/` |
| **DECA** | El conductor corrige mercancía, bultos, euro palets y peso de la orden de transporte en Odoo y descarga el PDF | Pantallas: `public/deca/` · API: `servicios/` (Python) |
| **ARGON** | Excel de Carburos → pedidos en Odoo. Lo llama n8n; no tiene pantallas | `servicios/argon/` |
| **Fichaje** | Entrada, pausas y salida. Se guarda en Supabase (registro de jornada) y se envía a Odoo (Asistencias) | `src/app/fichaje/` · `servicios/rrhh.py` |
| **Vacaciones y ausencias** | Pedir días; el responsable aprueba y se crea la solicitud en Odoo (Ausencias) | `src/app/ausencias/` · `servicios/rrhh.py` |
| **Mi equipo** | Para responsables: quién ha fichado, ausencias por aprobar, correcciones de fichajes y camión de cada chófer | `src/app/equipo/` |
| **Mi camión** | Chóferes: camión de hoy por la tarjeta del tacógrafo (Movildata), horas del día y empezar/terminar jornada (ficha a la vez) | `src/app/chofer/` · `servicios/chofer.py`, `servicios/movildata.py` |

Todo se publica en **un solo proyecto de Vercel**: Next.js para las pantallas y una función Python (`api/index.py`) para DECA y ARGON.

```
src/app/            páginas: inicio, login, admin, fichaje, ausencias, equipo, chofer; /api/sesion/token
src/lib/            clientes de Supabase, módulos, PIN
src/proxy.ts        renueva la sesión y manda al login a quien no la tenga
public/deca/        PWA de DECA (HTML/JS sin framework, funciona sin cobertura)
servicios/          API Python: DECA (main.py, service.py, odoo_client.py…), ARGON (argon/), fichaje y ausencias → Odoo
                    (rrhh.py), Movildata (movildata.py, chofer.py); supa.py lee/escribe en Supabase con el token del usuario
api/index.py        entrada de la función Python en Vercel
supabase/migrations SQL de tablas, permisos y altas
tests/              pruebas de la API Python      scripts/  diagnóstico, permisos de Odoo, prueba en navegador
```

---

## 1. Puesta en marcha (una sola vez)

### 1.1 Supabase
1. Proyecto **`app`** (región París, `eu-west-3`), URL `https://kcklgxmbojfpiwtsuibm.supabase.co`.
2. Las migraciones de `supabase/migrations/` **ya están aplicadas** (tablas, permisos RLS y ajustes de seguridad; los avisos de seguridad de Supabase salen limpios). Cualquier cambio futuro: un archivo nuevo en esa carpeta, nunca editar uno aplicado.
3. **Project Settings → API**: apunta la **URL**, la clave **publishable** (o *anon*) y la clave **secret** (o *service_role*). La secreta no se comparte nunca.
4. **Authentication → URL Configuration**: en *Site URL* pon la dirección de la app (p. ej. `https://app.grupotrimodos.com`) y en *Redirect URLs* añade `https://app.grupotrimodos.com/auth/callback` y `http://localhost:3000/auth/callback`.

### 1.2 Login con Microsoft (personal de oficina)
1. Pide a IT que registre una aplicación en **Microsoft Entra ID** (*App registrations → New registration*):
   - Tipo de cuenta: **solo este directorio** (la empresa).
   - Redirect URI (Web): `https://<tu-proyecto>.supabase.co/auth/v1/callback`.
   - Crear un **client secret** y apuntar *Application (client) ID*, el secreto y el *Directory (tenant) ID*.
2. En Supabase → **Authentication → Providers → Azure**: actívalo, pega el client ID y el secreto, y en *Azure Tenant URL* pon `https://login.microsoftonline.com/<tenant-id>`. Así **solo entran cuentas de la empresa**.

### 1.3 Conductores y operarios (código + PIN)
No hace falta configurar nada: los da de alta un administrador desde **Administración** en la app. Por dentro, Supabase guarda un correo interno (`<código>@pin.grupotrimodos.com`) que nadie ve. Deja **activado** el proveedor *Email* (Authentication → Providers), porque el PIN funciona como contraseña.

### 1.4 Primer administrador
1. Entra en la app con tu cuenta de Microsoft (verás «pendiente de activar»: es normal).
2. En Supabase → SQL Editor:
   ```sql
   update public.usuarios set activo = true, es_admin = true, modulos = '{deca}' where email = 'tu-correo@grupotrimodos.com';
   ```
3. Recarga la app: ya verás **Administración**. A partir de aquí todo se gestiona desde la app.

> **Toda cuenta nueva nace inactiva y sin módulos.** Hasta que un administrador la activa no ve nada, ni en las pantallas ni en la API.

### 1.5 Vercel
1. *Add New Project* → importar `grupotrimodos/app`. Vercel detecta **Next.js** solo; la función Python de `api/index.py` se publica en el mismo proyecto.
2. *Settings → Environment Variables*: todas las de `.env.example`, marcando como **Sensitive** las secretas (`SUPABASE_SECRET_KEY`, `ODOO_PASSWORD`, `ODOO_WEB_PASSWORD`, `SECRET_KEY`, `ARGON_CLAVE`, `ARGON_ODOO_PASSWORD`). Los cambios de variables se aplican con un **Redeploy**.
3. *Settings → Deployment Protection*: desactivar *Vercel Authentication* (la app ya tiene su propio login).
4. *Settings → Domains*: añadir el subdominio (p. ej. `app.grupotrimodos.com`).
5. **Uso con personal de la empresa = plan Pro** (el plan Hobby es solo para uso personal y no comercial).

### 1.6 n8n (ARGON)
ARGON mantiene su dirección: `POST https://<dominio>/api/argon/procesar` con la cabecera `X-Clave`. Solo hay que cambiar el dominio en n8n cuando se apague la app antigua.

---

## 2. Trabajar en local (Windows y Mac)

### Una sola vez
- Instalar **Node.js 22** y **Python 3.12**. Windows: `winget install -e --id OpenJS.NodeJS.LTS` y `winget install -e --id Python.Python.3.12`. Mac: `brew install node python@3.12`.
- En la carpeta del proyecto:
  ```bash
  npm install
  python -m venv .venv
  # Windows:  .\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
  # Mac:      .venv/bin/python -m pip install -r requirements-dev.txt
  ```
- Copia `.env.example` como **`.env.local`** (parte web) y como **`.env`** (API Python) y rellénalos. **Nunca se suben a git.**

### Cada vez
```bash
npm run dev        # web en http://localhost:3000 + API Python en el puerto 8000
```
`npm run dev` usa el `python` del sistema: activa antes el entorno (`.\.venv\Scripts\activate` en Windows, `source .venv/bin/activate` en Mac).

**Sin Supabase** (variables vacías) solo funciona DECA en **modo simulado**: abre `http://localhost:3000/deca/` y entras como «Usuario de prueba». El resto de la app muestra «no está configurada». En producción, sin Supabase, la API de DECA se niega a funcionar.

### Pruebas
```bash
.venv/bin/python -m pytest -q                              # API Python (DECA, ARGON, sesión)
npx tsc --noEmit && npx next build                         # web
.venv/bin/python -X utf8 -m scripts.prueba_navegador       # navegador real + cámara simulada (arranca web y API solas)
.venv/bin/python -X utf8 -m scripts.comprobar_permisos     # permisos del usuario técnico de Odoo, sin escribir
```
(En Windows, `.\.venv\Scripts\python.exe` en lugar de `.venv/bin/python`.)

---

## 3. Cómo funciona el acceso

1. **Microsoft** (oficina) o **código + PIN** (conductores y operarios) → sesión de Supabase en cookies.
2. `src/proxy.ts` renueva la sesión en cada página y manda al login a quien no la tenga.
3. La fila de `usuarios` dice si la persona está **activa**, si es **administradora** y a qué **módulos** tiene acceso; `usuario_centro_rol` dice su **rol en cada centro** (responsable, oficina, chófer, operario).
4. **RLS**: cada usuario solo puede leer su fila; solo un administrador puede cambiar usuarios, centros y roles. Aunque alguien manipule la web, la base de datos no lo permite.
5. **DECA**: sus pantallas piden el token a `/api/sesion/token` y lo mandan a la API Python (`Authorization: Bearer`). La API lo valida con Supabase y exige usuario **activo** con el módulo **`deca`**. El **nombre del conductor queda en la nota** de la tarea de Odoo.

## 4. Fichaje, ausencias y chóferes

- **Supabase es el registro de jornada.** Los fichajes no se borran ni se editan: si alguien se equivoca, su responsable añade una **corrección** con su motivo (queda quién y cuándo). Uno mismo solo puede fichar «ahora» (la base de datos rechaza horas pasadas o futuras).
- **Envío a Odoo:** tras cada fichaje la web llama a la API Python, que manda lo pendiente a `hr.attendance` (entrada/vuelta de pausa abren; pausa/salida cierran). Cada fichaje muestra si está en Odoo, pendiente o con error, y hay botón de reintentar. **`RRHH_DRY_RUN`** (por defecto `true`, independiente del `DRY_RUN` de DECA) marca «modo prueba» y no escribe nada en Odoo. Un registro ya enviado no se puede volver a enviar (lo impide la base de datos).
- Si Odoo rechaza un fichaje (p. ej. una entrada de otro día sin cerrar), queda en error y los siguientes de esa persona esperan hasta arreglarlo en Odoo y reintentar; las correcciones con hora pasada que Odoo rechace se arreglan a mano allí y no frenan al resto.
- Para que llegue a Odoo, cada persona necesita su **id de empleado de Odoo** (Administración → Editar).
- **Ausencias:** al aprobarlas se crea la solicitud en `hr.leave` con el tipo de `ODOO_TIPOS_AUSENCIA` (JSON, p. ej. `{"vacaciones": 1, "asuntos_propios": 2, "medico": 3, "otro": 4}` con los ids de los tipos de ausencia de vuestro Odoo). En Odoo queda para validar según su flujo.
- **Responsables:** el rol «Responsable» en un centro permite ver a las personas de ese centro, aprobar sus ausencias y corregir sus fichajes. Nadie aprueba ni corrige lo suyo.
- **Movildata:** `MOVILDATA_MODE=mock` (por defecto) simula la tarjeta y los datos del día con los camiones dados de alta en Administración. El modo real se implementará con la documentación de su API (`servicios/movildata.py`); mientras, el chófer elige la matrícula a mano.
- La web llama a la API Python con `VERCEL_URL` (o `APP_URL` si se define). Si el despliegue tiene *Vercel Authentication*, el envío a Odoo falla y queda pendiente para reintentar.

## 5. DECA: reglas y lecciones (no redescubrir)
- **Lista blanca en el cliente de Odoo** (`servicios/odoo_client.py`): solo se escriben `goods_id`, `number_of_packages`, `euro_pallet_qty` y `shipping_weight` de `tms.package`; nota solo en `project.task`; imprimir solo la orden de transporte. Hay tests que lo garantizan.
- **`DRY_RUN=true`** hace todo menos escribir/publicar/imprimir. Producción v15 solo con el pedido de prueba S2621473 y con permiso expreso.
- Editable solo en etapa «Nuevo» o «En desarrollo» (`EDITABLE_STAGES`); aviso de peso por MMA a partir de `PESO_AVISO_KG` (27.000).
- **Imprimir exige sesión web**: una clave API no sirve; hace falta `ODOO_WEB_PASSWORD` y el usuario técnico **sin 2FA**. El informe lee vehículos: el usuario técnico necesita *Fleet / Administrator* (o que Tecnativa lo lea con `sudo`).
- Odoo 18: `message_post` necesita `body_is_html=True` (la app lo envía solo en ≥ 18).
- Al cambiar archivos de `public/deca/`, **sube la versión de caché** en `public/deca/sw.js`.
- La guía de conductores se edita en `GUIA_CONDUCTORES.md` y se genera con `python -X utf8 -m scripts.generar_guia` (un test falla si se queda desfasada).

## 6. Añadir un módulo nuevo
1. Añádelo a `MODULOS` en `src/lib/modulos.ts` (id, nombre, descripción, ruta).
2. Pantallas en `src/app/<modulo>/` (o, como DECA, en `public/<modulo>/` si es una PWA aparte).
3. Si tiene API Python: rutas `/api/<modulo>/...` en `servicios/`, protegidas con `requiere_modulo("<modulo>")`, y su *rewrite* en `next.config.ts`.
4. Un administrador lo activa a quien corresponda desde **Administración**.
