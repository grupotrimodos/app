# ARGON (pedidos de Carburos)

Excel de Carburos → pedidos de venta en Odoo. Lo llama n8n; no tiene pantallas. Código: `servicios/argon/`.

- **n8n:** ARGON mantiene su dirección: `POST https://<dominio>/api/argon/procesar` con la cabecera `X-Clave`. Solo hay que cambiar el dominio en n8n cuando se apague la app antigua.
- **Escrituras en Odoo:** su lista `PERMITIDO` (`servicios/argon/argon_escritor.py`) está **congelada** (`AGENTS.md`, base 4): crear, cambiar y confirmar pedidos de venta y crear contenedores (`tms.equipment`). Su protección deja escribir sin más en cualquier dirección que contenga `stinsa18`, porque se escribió cuando era el Odoo de pruebas. **Desde el 30-10-2026 `stinsa18` es producción**, así que esa protección ya no frena nada: pendiente de decidir con Félix.
- Variables: `ARGON_CLAVE` y `ARGON_ODOO_*` en `.env.example`. Las pruebas con la Excel real necesitan `ARGON_EXCEL_PRUEBA` (si no, se saltan).
