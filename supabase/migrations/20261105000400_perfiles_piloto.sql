-- Piloto de fichaje y vacaciones (AGENTS.md, base 6): cada perfil se queda con fichar, vacaciones, su gestión y la
-- administración. Lo demás se oculta quitando el permiso: el código sigue ahí y se vuelve a dar desde
-- Administración → Perfiles. DECA no se toca: sigue en Chófer y Oficina.
with fuera (nombre, quitar) as (values
  ('Chófer', '{chofer.usar,ropa.pedir,documentos.propios,incidencias.reportar}'::text[]),
  ('Operario', '{ropa.pedir}'::text[]),
  ('Oficina', '{flota.ver,vehiculos.gestionar,incidencias.reportar}'::text[]),
  ('Responsable', '{ropa.gestionar}'::text[]),
  ('Seguridad', '{seguridad.ver,seguridad.gestionar}'::text[]),
  ('Administrador', '{direccion.finanzas,zonas.gestionar,ropa.gestionar,ropa.configurar,seguridad.ver,seguridad.gestionar,vehiculos.gestionar}'::text[])
)
update public.perfiles p
   set permisos = array(select x from unnest(p.permisos) as x where x <> all (f.quitar) order by x)
  from fuera f
 where p.nombre = f.nombre;

-- Los operarios vuelven a pedir vacaciones: entran en el piloto.
update public.perfiles
   set permisos = array(select distinct x from unnest(permisos || '{ausencias.pedir}'::text[]) as x order by x)
 where nombre = 'Operario';
