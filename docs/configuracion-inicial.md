# Configuración inicial (una sola vez)

Lo que se configura fuera del código: Supabase, los logins y Vercel. Las variables están en `.env.example`.

## 1. Supabase
1. Proyecto **`app`** (región París, `eu-west-3`), URL `https://kcklgxmbojfpiwtsuibm.supabase.co`.
2. Las migraciones de `supabase/migrations/` **ya están aplicadas** (tablas, permisos RLS y ajustes de seguridad). Los avisos que quedan en el asesor de seguridad de Supabase son intencionados: funciones que comprueban el permiso por dentro y tablas de tokens sin acceso para ningún usuario. Cualquier cambio futuro: un archivo nuevo en esa carpeta, nunca editar uno aplicado.
3. **Project Settings → API**: apunta la **URL**, la clave **publishable** (o *anon*) y la clave **secret** (o *service_role*). La secreta no se comparte nunca.
4. **Authentication → URL Configuration**: en *Site URL* pon la dirección de producción (`https://app-two-omega-92.vercel.app`) y en *Redirect URLs* añade `https://app-two-omega-92.vercel.app/auth/callback` y `http://localhost:3000/auth/callback`. Si se pone un dominio propio, se añade también.

## 2. Login con Microsoft (personal de oficina)
1. Pide a IT que registre una aplicación en **Microsoft Entra ID** (*App registrations → New registration*):
   - Tipo de cuenta: **solo este directorio** (la empresa).
   - Redirect URI (Web): `https://<tu-proyecto>.supabase.co/auth/v1/callback`.
   - Crear un **client secret** y apuntar *Application (client) ID*, el secreto y el *Directory (tenant) ID*.
2. En Supabase → **Authentication → Providers → Azure**: actívalo, pega el client ID y el secreto, y en *Azure Tenant URL* pon `https://login.microsoftonline.com/<tenant-id>`. Así **solo entran cuentas de la empresa**.
3. **Calendario de Outlook** (opcional; apagado hasta hacer esto): IT añade en la app de Entra los permisos delegados de Microsoft Graph `offline_access` y `Calendars.ReadWrite` y pulsa *Conceder consentimiento de administrador*. Después, en Vercel: `OUTLOOK_CALENDARIO=true`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (el *Valor* del secreto), `AZURE_TENANT_ID`, y que estén `SECRET_KEY` y `SUPABASE_SECRET_KEY`. Cada persona tiene que salir y volver a entrar con Microsoft una vez. **No activar `OUTLOOK_CALENDARIO` antes del consentimiento**: a todos les saldría «Se necesita la aprobación del administrador» al entrar.

## 3. Chóferes y operarios con Google
1. **Google Cloud Console** → *APIs y servicios* → *Credenciales* → *Crear ID de cliente de OAuth* (aplicación web). URI de redirección autorizada: `https://<tu-proyecto>.supabase.co/auth/v1/callback`. Solo pide nombre y correo: Google no exige revisión.
2. **Supabase → Authentication → Sign In / Providers → Google**: actívalo y pega el *Client ID* y el *Client Secret*.
3. **Vercel:** `LOGIN_GOOGLE=true` (sin esto el botón no sale) y Redeploy.
4. Es la forma de entrar elegida para chóferes y operarios. Quien entra con Google aparece **inactivo** en «Personas por configurar» hasta que le das puesto y centro.
5. **Enlace con Odoo:** su Gmail en el **«Correo de trabajo»** de su ficha de empleado (si no tiene correo de empresa), o en un campo propio de la ficha (p. ej. «Correo de acceso a la app») indicando su nombre técnico en `ODOO_CAMPO_CORREO=x_...`.

## 4. Chóferes y operarios con código + PIN
No hace falta configurar nada: los da de alta un administrador desde **Administración** en la app. Por dentro, Supabase guarda un correo interno (`<código>@pin.grupotrimodos.com`) que nadie ve. Deja **activado** el proveedor *Email* (Authentication → Providers), porque el PIN funciona como contraseña.

## 5. Primer administrador
1. Entra en la app con tu cuenta de Microsoft (verás «pendiente de activar»: es normal).
2. En Supabase → SQL Editor:
   ```sql
   update public.usuarios set activo = true, es_admin = true where email = 'tu-correo@grupotrimodos.com';
   ```
3. Recarga la app: ya verás **Administración** (eres **superadministrador**: lo ves todo). A partir de aquí todo se gestiona desde la app.

> **Toda cuenta nueva nace inactiva y sin perfiles.** Hasta que un administrador la activa no ve nada, ni en las pantallas ni en la API.

## 6. Vercel
1. *Add New Project* → importar `grupotrimodos/app`. Vercel detecta **Next.js** solo; la función Python de `api/index.py` se publica en el mismo proyecto.
2. *Settings → Environment Variables*: todas las de `.env.example`, marcando como **Sensitive** las secretas (`SUPABASE_SECRET_KEY`, `ODOO_PASSWORD`, `ODOO_WEB_PASSWORD`, `SECRET_KEY`, `ARGON_CLAVE`, `ARGON_ODOO_PASSWORD`, `CRON_SECRET`, `MOVILDATA_API_KEY`, `AZURE_CLIENT_SECRET`). Los cambios de variables se aplican con un **Redeploy**.
3. *Settings → Deployment Protection*: dejar **Standard Protection**. Protege la dirección propia de cada despliegue; la de producción queda abierta y la app tiene su propio login. Por eso la web llama a la API Python por el dominio de producción (`VERCEL_PROJECT_PRODUCTION_URL`), nunca por `VERCEL_URL`.
4. Producción: `https://app-two-omega-92.vercel.app` (equipo *grupo-trimodos* de Vercel, cuenta @grupotrimodos.com). Un dominio propio se añade en *Settings → Domains* y en las *Redirect URLs* de Supabase.
5. **Uso con personal de la empresa = plan Pro** (el plan Hobby es solo para uso personal y no comercial).
