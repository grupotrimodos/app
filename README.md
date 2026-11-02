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
| **Flota** | Centro de tráfico: mapa, última señal, movimiento, combustible, kilómetros, consumo diario y recorridos de los vehículos autorizados en Movildata | `src/app/flota/` · `servicios/flota.py`, `servicios/movildata.py` |
| **Mi camión** | Chóferes: confirmar el camión, consultar sus datos de Movildata y empezar/terminar jornada (ficha a la vez). La detección por tarjeta solo se simula en pruebas | `src/app/chofer/` · `servicios/chofer.py`, `servicios/movildata.py` |

Todo se publica en **un solo proyecto de Vercel**: Next.js para las pantallas y una función Python (`api/index.py`) para DECA y ARGON.

```
src/app/            páginas: inicio, login, admin, fichaje, ausencias, equipo, chofer, flota; /api/sesion/token
src/lib/            clientes de Supabase, módulos, PIN
src/proxy.ts        renueva la sesión y manda al login a quien no la tenga
public/deca/        PWA de DECA (HTML/JS sin framework, funciona sin cobertura)
servicios/          API Python: DECA (main.py, service.py, odoo_client.py…), ARGON (argon/), fichaje y ausencias → Odoo
                    (rrhh.py), Movildata (movildata.py, chofer.py, flota.py); supa.py lee/escribe en Supabase con el token del usuario
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
   update public.usuarios set activo = true, es_admin = true where email = 'tu-correo@grupotrimodos.com';
   ```
3. Recarga la app: ya verás **Administración** (eres **superadministrador**: lo ves todo). A partir de aquí todo se gestiona desde la app.

> **Toda cuenta nueva nace inactiva y sin perfiles.** Hasta que un administrador la activa no ve nada, ni en las pantallas ni en la API.

### 1.5 Vercel
1. *Add New Project* → importar `grupotrimodos/app`. Vercel detecta **Next.js** solo; la función Python de `api/index.py` se publica en el mismo proyecto.
2. *Settings → Environment Variables*: todas las de `.env.example`, marcando como **Sensitive** las secretas (`SUPABASE_SECRET_KEY`, `ODOO_PASSWORD`, `ODOO_WEB_PASSWORD`, `SECRET_KEY`, `ARGON_CLAVE`, `ARGON_ODOO_PASSWORD`, `CRON_SECRET`, `MOVILDATA_API_KEY`). Los cambios de variables se aplican con un **Redeploy**.
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
3. **Perfiles configurables.** Un *perfil* es un puesto (Chófer, Operario de almacén, Jefe de tráfico, RR. HH.…) con una lista de **permisos**. El administrador crea y edita perfiles desde **Administración → Perfiles** marcando casillas, y asigna a cada persona uno o varios perfiles **por centro** (`perfiles`, `usuario_perfil`). Lo que ve y puede hacer una persona es la suma de sus perfiles.
   - Los permisos sobre otras personas (ver equipo, aprobar ausencias, corregir fichajes) valen en los centros donde tiene ese perfil, o en **todos** si el perfil lo marca.
   - `usuarios.es_admin` = **superadministrador**: todo, en todos los centros. Solo otro superadministrador (o el editor SQL de Supabase) puede nombrarlo o cambiar su ficha.
   - El permiso «Gestionar usuarios, perfiles y centros» puede darse cualquier otro permiso: solo para administración.
4. **Catálogo único de permisos:** `src/lib/permisos.json` (áreas y permisos). De ahí salen las tarjetas del inicio (se ve un área si se tiene algún permiso de ella) y las casillas del editor de perfiles. Los mismos identificadores los exigen la base de datos (`privado.tengo_permiso`, `privado.puedo_sobre`) y la API Python (`requiere_permiso`).
5. **RLS**: aunque alguien manipule la web, la base de datos solo deja hacer lo que permiten sus perfiles.
6. **DECA**: sus pantallas piden el token a `/api/sesion/token` y lo mandan a la API Python (`Authorization: Bearer`). La API lo valida con Supabase y exige usuario **activo** con el permiso **`deca.usar`**. El **nombre del conductor queda en la nota** de la tarea de Odoo.

## 4. Fichaje, ausencias y chóferes

- **Supabase es el registro de jornada.** Los fichajes no se borran ni se editan: si alguien se equivoca, su responsable añade una **corrección** con su motivo (queda quién y cuándo). Uno mismo solo puede fichar «ahora» (la base de datos rechaza horas pasadas o futuras).
- **Envío a Odoo:** tras cada fichaje la web llama a la API Python, que manda lo pendiente a `hr.attendance` (entrada/vuelta de pausa abren; pausa/salida cierran). Cada fichaje muestra si está en Odoo, pendiente o con error, y hay botón de reintentar. **`RRHH_DRY_RUN`** (por defecto `true`, independiente del `DRY_RUN` de DECA) marca «modo prueba» y no escribe nada en Odoo. Un registro ya enviado no se puede volver a enviar (lo impide la base de datos).
- Si Odoo rechaza un fichaje (p. ej. una entrada de otro día sin cerrar), queda en error y los siguientes de esa persona esperan hasta arreglarlo en Odoo y reintentar; las correcciones con hora pasada que Odoo rechace se arreglan a mano allí y no frenan al resto.
- **Ficha de empleado automática:** para llegar a Odoo hace falta el id de empleado. Se busca solo: por **correo de trabajo** (quien entra con Microsoft) o por el **código** en el campo «Credencial» (`barcode`) de la ficha (quien entra con código + PIN). Si hay varias o ninguna, la pantalla de Sincronización lo dice y se pone a mano en Administración.
- **Ausencias:** al aprobarlas se crea la solicitud en `hr.leave`. El tipo de Odoo se elige **solo por su nombre** (vacaciones, enfermedad/médico, asuntos propios, no retribuido…). Para forzarlo: `ODOO_TIPOS_AUSENCIA` (JSON, p. ej. `{"vacaciones": 1}`). En Odoo queda para validar según su flujo.
- **Mi equipo:** con los permisos «Ver a las personas de sus centros», «Aprobar ausencias» y «Corregir fichajes» (perfil «Responsable» de serie). Nadie aprueba ni corrige lo suyo.
- **Movildata real:** configura `MOVILDATA_API_KEY` en Vercel como variable sensible y `MOVILDATA_MODE=real` (si se omite el modo, una clave configurada activa el modo real). Después hay que desplegar esta versión. Una variable antigua `MOVILDATA_MODE=mock` mantiene explícitamente el modo de prueba.
- **Centro de flota:** `/flota`, protegido por el permiso global **`flota.ver`**, consulta los vehículos que autoriza la cuenta Movildata: no hay matrículas ni un número de vehículos fijados en código. El administrador marca «Ver posición y actividad de toda la flota de Movildata» en los perfiles de tráfico que deban consultarla. Este permiso abarca la cuenta completa, independientemente del centro; no se asigna automáticamente a perfiles existentes.
- La integración usa solo lecturas documentadas en [la API oficial de Movildata](https://mapi.movildata.com/Help): `GetVehiculos`, `GetLastLocations`, `GetLastConsumptions`, `GetDataBetweenDates` y `GetGPSData`. Los servicios no contratados, sensores sin lectura y errores se muestran como datos no disponibles; nunca se sustituyen por cifras de prueba. Las consultas se reutilizan 60 segundos para limitar llamadas. Una señal de más de 15 minutos se distingue de una posición reciente.
- El resumen del día y los recorridos usan **Europe/Madrid**. Se puede consultar un recorrido de los últimos 31 días, dentro de la disponibilidad de Movildata. Si supera 1.000 puntos, se simplifica para visualizarlo y se indica. La clave nunca llega al navegador; las rutas `/api/flota/*` exigen sesión real y permiso, incluso cuando DECA está en pruebas.
- **Mi camión:** el conductor confirma su camión y recibe únicamente la telemetría de su asignación abierta, comprobada con su sesión en Supabase. En modo real no se identifica al conductor por la matrícula ni se calculan tiempos legales de conducción a partir del GPS. En modo `mock` la demostración de tarjeta y jornada se identifica expresamente como simulada.
- La web llama a la API Python con `VERCEL_URL` (o `APP_URL` si se define). Si el despliegue tiene *Vercel Authentication*, el envío a Odoo falla y queda pendiente para reintentar.

## 5. Sincronización automática con Odoo

Nadie tiene que decidir dónde va cada dato: `servicios/sincronizacion.py` tiene un **mapa** por tipo de dato con la aplicación de Odoo que lo guarda y quién manda.

| Dato | Sentido | Aplicación de Odoo |
|---|---|---|
| Fichas de empleado | Odoo → app (enlace automático) | Empleados (`hr`) |
| Fichajes | app → Odoo | Asistencias (`hr_attendance`) |
| Vacaciones y ausencias aprobadas | app → Odoo | Ausencias (`hr_holidays`) |
| Camiones | Odoo → app | Flota (`fleet`) |

- Antes de enviar mira qué aplicaciones están **instaladas** en Odoo; si falta una, ese dato se salta y se explica (nunca se fuerza otro sitio).
- Se envía **al momento** con cada acción; además hay una **pasada automática** diaria (cron de Vercel a las 4:00 UTC, necesita `CRON_SECRET`) y el botón **Sincronizar ahora** en **Administración → Sincronización** (permiso «Ver y lanzar la sincronización»). Para más pasadas al día: un flujo de n8n que llame a `GET /api/odoo/procesar` con `Authorization: Bearer <CRON_SECRET>`.
- El **estado de envío** (enviado, error…) solo lo escribe el servidor con la **clave de servidor** (`SUPABASE_SECRET_KEY`), después de comprobar con el token del usuario que puede ver ese registro. Sin esa variable en Vercel, todo se guarda pero nada llega a Odoo. Cada pasada queda en `odoo_sincronizacion`.
- Con `RRHH_DRY_RUN=true` o con Odoo simulado (`ODOO_MODE=mock`) los registros quedan como **«simulado»** y no se guarda nada leído de Odoo (ni fichas ni camiones de prueba). Si al pasar a real se quiere enviar lo fichado en pruebas, en el editor SQL de Supabase: `update fichajes set odoo_estado = 'pendiente' where odoo_estado = 'simulado' and momento >= '<fecha>';` (desde la app no se puede).
- **Añadir un dato nuevo** (p. ej. documentación de vehículos): una entrada en `MAPAS` y su función en `PASOS`, sus lecturas/escrituras en la lista blanca de `odoo_client.py` y sus tests.

## 6. DECA: reglas y lecciones (no redescubrir)
- **Lista blanca en el cliente de Odoo** (`servicios/odoo_client.py`): solo se escriben `goods_id`, `number_of_packages`, `euro_pallet_qty` y `shipping_weight` de `tms.package`; nota solo en `project.task`; imprimir solo la orden de transporte. Hay tests que lo garantizan.
- **`DRY_RUN=true`** hace todo menos escribir/publicar/imprimir. Producción v15 solo con el pedido de prueba S2621473 y con permiso expreso.
- Editable solo en etapa «Nuevo» o «En desarrollo» (`EDITABLE_STAGES`); aviso de peso por MMA a partir de `PESO_AVISO_KG` (27.000).
- **Imprimir exige sesión web**: una clave API no sirve; hace falta `ODOO_WEB_PASSWORD` y el usuario técnico **sin 2FA**. El informe lee vehículos: el usuario técnico necesita *Fleet / Administrator* (o que Tecnativa lo lea con `sudo`).
- Odoo 18: `message_post` necesita `body_is_html=True` (la app lo envía solo en ≥ 18).
- Al cambiar archivos de `public/deca/`, **sube la versión de caché** en `public/deca/sw.js`.
- La guía de conductores se edita en `GUIA_CONDUCTORES.md` y se genera con `python -X utf8 -m scripts.generar_guia` (un test falla si se queda desfasada).

## 7. Añadir una función nueva
1. Añade su **área y sus permisos** a `src/lib/permisos.json` (p. ej. `almacen.inventario`). Aparecen solos en el inicio y en el editor de perfiles.
2. Pantallas en `src/app/<area>/`, protegidas con `conPermiso("<permiso>")` (o, como DECA, en `public/<area>/` si es una PWA aparte).
3. Tablas nuevas con una **migración nueva**, RLS y políticas con `privado.tengo_permiso('<permiso>')` o `privado.puedo_sobre('<permiso>', usuario_id)`.
4. Si tiene API Python: rutas `/api/<area>/...` en `servicios/`, protegidas con `requiere_permiso("<permiso>")`, su *rewrite* en `next.config.ts` y su exclusión en `src/proxy.ts`.
5. Si algo debe llegar a Odoo: un mapa en `servicios/sincronizacion.py`.
6. El administrador marca el permiso en los perfiles que correspondan desde **Administración → Perfiles**.
