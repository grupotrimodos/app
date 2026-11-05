# Acceso, perfiles y pantallas

## Cómo funciona el acceso

1. **Microsoft** (oficina), **Google** (chóferes y operarios, cuando se active) o **código + PIN** → sesión de Supabase en cookies.
2. `src/proxy.ts` renueva la sesión en cada página y manda al login a quien no la tenga.
3. **Perfiles configurables.** Un *perfil* es un puesto (Chófer, Operario de almacén, Jefe de tráfico, RR. HH.…) con una lista de **permisos**. El administrador crea y edita perfiles desde **Administración → Perfiles** marcando casillas, y asigna a cada persona uno o varios perfiles **por centro** (`perfiles`, `usuario_perfil`). Lo que ve y puede hacer una persona es la suma de sus perfiles.
   - Los permisos sobre otras personas (ver equipo, aprobar ausencias, corregir fichajes) valen en los centros donde tiene ese perfil, o en **todos** si el perfil lo marca.
   - `usuarios.es_admin` = **superadministrador**: todo, en todos los centros. Solo otro superadministrador (o el editor SQL de Supabase) puede nombrarlo o cambiar su ficha.
   - El permiso «Gestionar usuarios, perfiles y centros» puede darse cualquier otro permiso: solo para administración.
4. **Catálogo único de permisos:** `src/lib/permisos.json` (áreas y permisos). De ahí salen el menú y las herramientas del inicio y las casillas del editor de perfiles. Los mismos identificadores los exigen la base de datos (`privado.tengo_permiso`, `privado.puedo_sobre`) y la API Python (`requiere_permiso`).
5. **RLS**: aunque alguien manipule la web, la base de datos solo deja hacer lo que permiten sus perfiles.
6. **DECA**: sus pantallas piden el token a `/api/sesion/token` y lo mandan a la API Python (`Authorization: Bearer`). La API lo valida con Supabase y exige usuario **activo** con el permiso **`deca.usar`**. El **nombre del conductor queda en la nota** de la tarea de Odoo.

## Perfiles y pantallas

- **Cuatro perfiles básicos, que no se borran ni cambian de nombre** (`perfiles.base`, lo impide la base de datos): **Administrador**, **Oficina**, **Chófer** y **Operario**. Cada persona tiene **un puesto en su centro**. Encima se le suman **complementos**: **Responsable**, que aprueba lo de su centro, y **Seguridad**, que vale en todos los centros. Los permisos de cada perfil se siguen editando con casillas.
- **Cada perfil tiene su pantalla** (`perfiles.pantalla`). Si alguien tiene varias, manda la de más alcance. El superadministrador sin perfiles entra en Dirección.
  - **Dirección** (`direccion`): el inicio es el cuadro de mando. No hay fichaje ni flota.
  - **Oficina** (`oficina`): espacio de gestión con menú lateral: su jornada, la flota, DECA y lo que tenga que resolver.
  - **Campo** (`campo`, chóferes y operarios): **una sola pantalla en el móvil, sin menú** (`src/app/InicioCampo.tsx`). Arriba, fichar con un botón grande y su camión. Debajo, sus avisos y su ropa de temporada. Al final, solo los accesos que da su perfil. En las demás pantallas, un botón «Inicio» para volver.
- **Menú** (`src/lib/usuario.ts`, `enMenu`): en `permisos.json` los permisos del trabajo propio llevan `"de_puesto": true` (fichar, su camión, la flota, DECA, ausencias, documentación, incidencias, pedir ropa). Esos solo ponen su área en el menú si vienen de los perfiles de la persona. Los de gestión salen siempre, también al superadministrador. Así Dirección no ve fichaje ni flota, aunque pueda abrirlos.
- **Permisos en el piloto de fichaje y vacaciones** (migración `20261105000400_perfiles_piloto.sql`; lo demás está oculto, no borrado):
  - **Administrador:** cuadro de mando (`direccion.ver`, sin finanzas), Mi equipo (ver, aprobar vacaciones, corregir fichajes) y administración (personas y sincronización con Odoo).
  - **Oficina:** fichar, pedir vacaciones y DECA.
  - **Chófer:** fichar, pedir vacaciones y DECA.
  - **Operario:** fichar y pedir vacaciones.
  - **Responsable** (complemento): ver a su equipo, aprobar vacaciones y corregir fichajes de su centro.
  - **Seguridad** (complemento): sin permisos durante el piloto.
  - El superadministrador sigue teniéndolo todo.
  - Al guardar el perfil Chófer en Administración vuelve «Mi documentación» (`documentos.propios`), porque el puesto pide documentos. Para que no vuelva, hay que desmarcar también esos documentos.
  - El cuadro de mando cuenta como chóferes a quien tiene «Mi camión» (`chofer.usar`), así que durante el piloto esa cifra sale a 0.
- **Administración a escala** (`/admin`), con pestañas:
  - **Personas:** búsqueda, filtros por centro, perfil y estado y páginas de 50. Quien entra por primera vez con Google o Microsoft aparece en «Por configurar» y se activa **en bloque**: se marcan, se elige puesto y centro, y listo. «Cambiar puesto» sustituye el puesto y conserva los complementos.
  - **Perfiles**, **Centros** (con su analítica de Odoo) y **Camiones**.
  - Cada acción vuelve a la misma pestaña con sus filtros.
- **Ropa por temporada** (`/ropa`; tablas `ropa_kits`, `tallas_ropa`, `ropa_dotaciones`):
  - **Temporadas y dotación:** el verano va del 1 de abril al 30 de septiembre y el invierno del 1 de octubre al 31 de marzo. Cada puesto tiene la composición de **una muda** por temporada y cuántas mudas tocan (2). La dotación de cada persona se prepara sola (`public.preparar_dotaciones()`), así que nadie la tiene que pedir. Las dotaciones aún sin entregar siguen a quién le toca ahora: si alguien se da de baja o cambia a un puesto sin ropa, la suya desaparece de la lista.
  - **Tallas:** cada uno apunta cuatro tallas: parte de arriba, pantalón, calzado y guantes. Puede hacerlo también su responsable.
  - **Entrega y confirmación:** el responsable ve **qué preparar**, con unidades por prenda y talla para el pedido al proveedor, y marca cada dotación como entregada. La persona confirma que la ha recibido. Nadie se entrega lo suyo.
  - **Cambios:** las solicitudes sueltas quedan para roturas, tallas o pérdidas.
  - **Permisos:** `ropa.pedir`, `ropa.gestionar` y `ropa.configurar` (para la composición).
- **Chóferes por cliente o ruta** (`/equipo/zonas`; tablas `zonas` y `chofer_zona`; permiso `zonas.gestionar`): cada chófer de sus centros tiene una zona, que es un cliente o una ruta. Se asignan todos de una vez. El cuadro de mando separa a los chóferes por zona: cuántos hay, cuántos han fichado y trabajan, cuántos tienen camión y su documentación.
- **Analítica de cada centro** (Administración → Centros; tabla `centro_analitica`): qué cuentas o etiquetas analíticas de Odoo son de cada centro. Con ellas el cuadro de mando separa ingresos, gastos y margen por centro. Una cuenta o etiqueta solo puede ser de un centro.
