# Odoo

Odoo es la base de datos principal. Qué se puede leer y escribir: `AGENTS.md`, base 4. Todo pasa por `servicios/odoo_client.py` (lista blanca `ALLOWED_CALLS`); ARGON tiene su propia lista congelada.

## Sincronización automática

Nadie tiene que decidir dónde va cada dato: `servicios/sincronizacion.py` tiene un **mapa** por tipo de dato con la aplicación de Odoo que lo guarda y quién manda.

| Dato | Sentido | Aplicación de Odoo |
|---|---|---|
| Fichas de empleado | Odoo → app (enlace automático) | Empleados (`hr`) |
| Fichajes | app → Odoo | Asistencias (`hr_attendance`) |
| Vacaciones y ausencias aprobadas | app → Odoo | Ausencias (`hr_holidays`) |
| Camiones | Odoo → app | Flota (`fleet`) |

> Por las bases de `AGENTS.md`, fichajes, vacaciones y camiones deben pasar a mandar desde Odoo, sin copias que se editen en la app. Está pendiente de encargos aparte.

- Antes de enviar mira qué aplicaciones están **instaladas** en Odoo; si falta una, ese dato se salta y se explica (nunca se fuerza otro sitio).
- Se envía **al momento** con cada acción; además hay una **pasada automática** diaria (cron de Vercel a las 4:00 UTC, necesita `CRON_SECRET`) y el botón **Sincronizar ahora** en **Administración → Sincronización** (permiso «Ver y lanzar la sincronización»). Para más pasadas al día: un flujo de n8n que llame a `GET /api/odoo/procesar` con `Authorization: Bearer <CRON_SECRET>`.
- El **estado de envío** (enviado, error…) solo lo escribe el servidor con la **clave de servidor** (`SUPABASE_SECRET_KEY`), después de comprobar con el token del usuario que puede ver ese registro. Sin esa variable en Vercel, todo se guarda pero nada llega a Odoo. Cada pasada queda en `odoo_sincronizacion`.
- Con `RRHH_DRY_RUN=true` o con Odoo simulado (`ODOO_MODE=mock`) los registros quedan como **«simulado»** y no se guarda nada leído de Odoo (ni fichas ni camiones de prueba). Si al pasar a real se quiere enviar lo fichado en pruebas, en el editor SQL de Supabase: `update fichajes set odoo_estado = 'pendiente' where odoo_estado = 'simulado' and momento >= '<fecha>';` (desde la app no se puede).
- **Añadir un dato nuevo** (p. ej. documentación de vehículos): una entrada en `MAPAS` y su función en `PASOS`, sus lecturas/escrituras en la lista blanca de `odoo_client.py` y sus tests.

## Lecturas para el cuadro de mando (solo totales)

- **Finanzas de dirección en Odoo** (`servicios/direccion.py`, todo GET, solo lectura y solo totales):
  - `/api/odoo/finanzas` (permiso `direccion.finanzas`): facturación y ventas de los últimos 24 meses con sus comparativas (mes en curso frente al mismo día del mes anterior y del año pasado, año en curso frente al año pasado hasta el mismo día), cobros y pagos pendientes (vencido, lo que vence en 7 y 30 días, antigüedad en 5 tramos y los 8 clientes o proveedores con más pendiente) y pedidos confirmados sin facturar (y los de más de 30 días).
  - `/api/odoo/centros` (`direccion.finanzas`): ingresos, gastos y margen de cada centro activo según sus **cuentas o etiquetas analíticas**. Qué analítica es de cada centro se guarda en Supabase (`centro_analitica`) y se lee con el token de quien mira. Un centro sin analítica sale como «sin configurar».
  - `/api/odoo/analitica` (`admin.usuarios`): catálogo de cuentas y etiquetas analíticas para asignarlas a los centros.
  - `/api/odoo/comercial` (`direccion.ver`) añade las oportunidades ganadas y nuevas del mes anterior hasta el mismo día.
  - Todas aceptan `?empresa=<id>` (uno de `ODOO_COMPANY_IDS`; otro da error 400). Cada parte se calcula por separado: si falla o falta su aplicación, llega vacía con su aviso. Caché de 10 minutos (5 el comercial; 1 si algo falló). «Hoy» es el día de Madrid.
  - **Permisos de lectura** del usuario técnico de Odoo (en las dos empresas): facturas y apuntes (`account.move`, `account.move.line`), pedidos y sus líneas (`sale.order`, `sale.order.line`, de **todos** los comerciales, no «solo sus documentos»), cuentas y etiquetas analíticas (`account.analytic.account`, `account.analytic.tag`) y empresas (`res.company`). `scripts.comprobar_permisos` ya los comprueba. Odoo 15: las etiquetas analíticas desaparecen en Odoo 16 (allí habría que leer `analytic_distribution`).
