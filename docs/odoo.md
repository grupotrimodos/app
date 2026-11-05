# Odoo

Odoo es la base de datos principal. Qué se puede leer y escribir: `AGENTS.md`, base 4. Todo pasa por `servicios/odoo_client.py` (lista blanca `ALLOWED_CALLS`); ARGON tiene su propia lista congelada.

## Leer y escribir en Odoo

**Leer:** cualquier modelo, solo con los métodos de lectura (`METODOS_LECTURA` en `servicios/odoo_client.py`). Lo leído
solo llega a una pantalla por una ruta concreta de la API con su permiso. No existe ninguna ruta que lea «el modelo que le
pidan», y `tests/test_odoo_escrituras.py` falla si aparece. Nóminas, salarios, contratos y contabilidad solo se enseñan
con el permiso que les corresponda (hoy, la contabilidad resumida con `direccion.finanzas`).

**Escribir:** solo la lista cerrada `ESCRITURAS`. Cada entrada dice qué toca y la única función que la usa:

| Qué | Modelo y método | Lo provoca | Interruptor |
|---|---|---|---|
| Abrir la asistencia de un empleado | `hr.attendance` · `create` | Fichar entrada o volver de la pausa | `RRHH_DRY_RUN` |
| Cerrar su asistencia abierta (solo la hora de salida) | `hr.attendance` · `write` | Fichar pausa o salida | `RRHH_DRY_RUN` |
| Crear la solicitud de una ausencia | `hr.leave` · `create` | Su responsable la aprueba en la app; en Odoo queda por validar | `RRHH_DRY_RUN` |
| Mercancía, bultos, euro palets y peso de un bulto | `tms.package` · `write` (solo esos 4 campos) | El chófer corrige su orden en DECA | `DRY_RUN` |
| Nota en la tarea de la orden | `project.task` · `message_post` | DECA, al guardar | `DRY_RUN` |

ARGON tiene su propia lista, congelada (`docs/argon.md`). Borrar (`unlink`), nunca.

**Cómo se escribe (procedimiento fijo):**
1. **Primero se guarda en Supabase.** El registro (fichaje, ausencia) hace de cola: `odoo_estado` es pendiente, enviado,
   error, sin empleado o simulado. Se guarda también el id de Odoo y el motivo del error. DECA es la excepción: escribe
   al momento en la orden y deja su nota.
2. **Sale por su mapa** de `servicios/sincronizacion.py`, nunca por envíos sueltos. Se intenta al momento y la pasada
   automática diaria (o el botón «Sincronizar ahora») reintenta lo pendiente.
3. **Una sola vez:** lo enviado no se vuelve a enviar (lo impide la base de datos).
4. **Solo se crea o se completa lo propio:** una asistencia o una solicitud nuevas, cerrar la asistencia abierta de esa
   persona y los 4 campos de DECA. Nunca se corrige desde la app lo que alguien ha cambiado en Odoo: si algo está mal,
   se arregla en Odoo y se reintenta.
5. **Con interruptor:** con `RRHH_DRY_RUN=true` (fichajes y ausencias) o `DRY_RUN=true` (DECA) no sale nada; el registro
   queda como «simulado» y no se reenvía al apagarlo. En producción: `RRHH_DRY_RUN=false` (autorizado por Félix el
   5-11-2026) y `DRY_RUN=true`.
6. **A la vista:** cada registro enseña si está en Odoo, y los errores salen en Administración → Sincronización.
7. **Escritura nueva:** se propone a Félix con el modelo, los campos, quién la provoca, cuándo, cómo se ve si falla y cómo
   se deshace en Odoo. Solo con su permiso expreso se añade a `ESCRITURAS`, a su mapa y a la prueba.

## Sincronización automática

Nadie tiene que decidir dónde va cada dato: `servicios/sincronizacion.py` tiene un **mapa** por tipo de dato con la aplicación de Odoo que lo guarda y quién manda.

| Dato | Sentido | Aplicación de Odoo |
|---|---|---|
| Fichas de empleado | Odoo → app (enlace automático) | Empleados (`hr`) |
| Fichajes | app → Odoo | Asistencias (`hr_attendance`) |
| Vacaciones y ausencias aprobadas | app → Odoo | Ausencias (`hr_holidays`) |
| Camiones | Odoo → app | Flota (`fleet`) |

> Por las bases de `AGENTS.md`, deben pasar a mandar desde Odoo, sin copias que se editen en la app (pendiente de encargos aparte):
> - **Fichajes y vacaciones:** hoy se guardan en Supabase (`fichajes`, `ausencias`) y Odoo recibe una copia.
> - **Chóferes y flota:** hoy la app copia los camiones de Odoo en `vehiculos` y deja darlos de alta y de baja en Administración → Camiones. Además guarda en `asignaciones` qué camión lleva cada chófer, y en `usuarios` su tarjeta de tacógrafo.
> - **Documentación de chóferes y vehículos:** hoy se apunta en la app (`documentos`: carnés, CAP, tarjeta, reconocimiento, ITV, seguro, tacógrafo), y ya está en Odoo.
>
> Para leerla de Odoo hay que saber en qué modelos y campos está. Eso exige abrir lecturas que hoy no están en la lista de `odoo_client.py` (por ejemplo `fields_get` de empleados y vehículos), un encargo aparte.

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
