# Base de datos (Supabase): lo que no se usa

Revisión del 6-11-2026. No se borra nada: una columna fuera exige una migración nueva y el permiso de Félix
(`AGENTS.md`). Antes de volver a usar una de estas, mira si el dato ya está en Odoo (base 3).

## Columnas que nadie escribe ni lee

| Columna | Por qué está así |
|---|---|
| `usuarios.movildata_driver_id`, `usuarios.tarjeta_tacografo` | De cuando se pensó guardar el conductor de Movildata. Movildata se consulta en directo y la tarjeta está en Odoo. |
| `vehiculos.id_movildata` | Igual: la flota se lee en directo. |
| `documentos.nota` | El formulario de documentación nunca la pidió. |
| `incidencias.equipo_id` | El formulario de incidencias no tiene el campo «equipo»: siempre vacía. |
| `vehiculos.odoo_id` | Solo la usaba la copia de la flota de Odoo, que está en pausa (`docs/odoo.md`). |

## Columnas que se escriben y solo sirven de registro

Quién y cuándo, para saber qué pasó, aunque ninguna pantalla los enseñe: `documentos.actualizado` y `actualizado_por`,
`equipo_revisiones.creado_por`, `inspecciones.realizada_por`, `incidencias.cerrada_por`, `solicitudes_ropa.resuelto_por` y
`entregado_por`, `ropa_dotaciones.entregado_por` y `tallas` (tallas con las que se entregó), `fichajes.creado_por` (quién
corrigió), `chofer_zona.asignado_por` y `asignado_en`, `tallas_ropa.actualizado`, `microsoft_tokens.actualizado`,
`odoo_sincronizacion.fin`, `outlook_eventos.usuario_id` y `asignaciones.origen`.

## Otras cosas

- **`centros.activo`:** no se puede cambiar desde la app; el cuadro de mando y la API de finanzas solo cuentan los
  activos, y el resto de pantallas los enseña todos. Si un día se desactiva un centro a mano, revisa esas listas.
- **`public.resumen_direccion()`** calcula algunas cifras que el cuadro de mando no enseña (en pausa, trabajando por
  centro, chóferes por centro, ropa por entregar). No molestan; se quitarían en una migración nueva si estorban.
- **Variables de la API Python** `SUPABASE_URL` y `SUPABASE_ANON_KEY`: si existen, la API las usa en lugar de las
  `NEXT_PUBLIC_SUPABASE_*` de la web (las pruebas las usan). En producción no deben ponerse, para que web y API usen
  el mismo Supabase.
