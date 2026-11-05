# DECA: reglas y lecciones (no redescubrir)

- **Lista blanca en el cliente de Odoo** (`servicios/odoo_client.py`): solo se escriben `goods_id`, `number_of_packages`, `euro_pallet_qty` y `shipping_weight` de `tms.package`; nota solo en `project.task`; imprimir solo la orden de transporte. Hay tests que lo garantizan.
- **`DRY_RUN=true`** hace todo menos escribir/publicar/imprimir. Producción v15 solo con el pedido de prueba S2621473 y con permiso expreso.
- Editable solo en etapa «Nuevo» o «En desarrollo» (`EDITABLE_STAGES`); aviso de peso por MMA a partir de `PESO_AVISO_KG` (27.000).
- **Imprimir exige sesión web**: una clave API no sirve; hace falta `ODOO_WEB_PASSWORD` y el usuario técnico **sin 2FA**. El informe lee vehículos: el usuario técnico necesita *Fleet / Administrator* (o que Tecnativa lo lea con `sudo`).
- Odoo 18: `message_post` necesita `body_is_html=True` (la app lo envía solo en ≥ 18).
- Al cambiar archivos de `public/deca/`, **sube la versión de caché** en `public/deca/sw.js`.
- La guía de conductores se edita en `GUIA_CONDUCTORES.md` y se genera con `python -X utf8 -m scripts.generar_guia` (un test falla si se queda desfasada).
