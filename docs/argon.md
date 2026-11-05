# ARGON (pedidos de Carburos)

Excel de Carburos → pedidos de venta en Odoo. Lo llama n8n; no tiene pantallas. Código: `servicios/argon/`.

- **n8n:** ARGON mantiene su dirección: `POST https://<dominio>/api/argon/procesar` con la cabecera `X-Clave`. Solo hay que cambiar el dominio en n8n cuando se apague la app antigua.
- **Escrituras en Odoo:** su lista `PERMITIDO` (`servicios/argon/argon_escritor.py`) está **congelada** (`AGENTS.md`, base 4): crear, cambiar y confirmar pedidos de venta y crear contenedores (`tms.equipment`). Solo escribe en el Odoo de pruebas (`stinsa18`) salvo `ARGON_PERMITIR_PRODUCCION=1`.
- Variables: `ARGON_CLAVE` y `ARGON_ODOO_*` en `.env.example`. Las pruebas con la Excel real necesitan `ARGON_EXCEL_PRUEBA` (si no, se saltan).
