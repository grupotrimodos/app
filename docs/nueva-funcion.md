# Añadir una función nueva

> En la fase de piloto no se añaden funciones (`AGENTS.md`, base 6). Antes de crear una tabla, comprueba si el dato ya está en Odoo (base 3).

1. 1. Añade su **área y sus permisos** a `src/lib/permisos.json` (p. ej. `almacen.inventario`). Aparecen solos en el menú y en el editor de perfiles.
2. Pantallas en `src/app/<area>/`, protegidas con `conPermiso("<permiso>")` (o, como DECA, en `public/<area>/` si es una PWA aparte).
3. Tablas nuevas con una **migración nueva**, RLS y políticas con `privado.tengo_permiso('<permiso>')` o `privado.puedo_sobre('<permiso>', usuario_id)`.
4. Si tiene API Python: rutas `/api/<area>/...` en `servicios/`, protegidas con `requiere_permiso("<permiso>")`, su *rewrite* en `next.config.ts` y su exclusión en `src/proxy.ts`.
5. Si algo debe llegar a Odoo: un mapa en `servicios/sincronizacion.py`.
6. El administrador marca el permiso en los perfiles que correspondan desde **Administración → Perfiles**.
