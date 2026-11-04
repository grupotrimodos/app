-- Cuadro de mando de dirección: cifras de toda la empresa en una sola consulta. Solo para quien tiene «direccion.ver»
-- (el superadministrador lo tiene siempre). Devuelve SOLO totales: ningún nombre ni dato de una persona concreta.
-- «Hoy» es el día de Madrid. Una persona cuenta si está activa y tiene algún perfil.
create or replace function public.resumen_direccion()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  hoy date := (now() at time zone 'Europe/Madrid')::date;
  desde_hoy timestamptz := (hoy::timestamp at time zone 'Europe/Madrid');
  resultado jsonb;
begin
  if not (select privado.tengo_permiso('direccion.ver')) then
    raise exception 'No tienes permiso para el cuadro de mando' using errcode = '42501';
  end if;

  with activos as (
    select u.id from public.usuarios u
    where u.activo and exists (select 1 from public.usuario_perfil up where up.usuario_id = u.id)
  ),
  ultimo as (   -- último fichaje de las últimas 24 h: cómo está ahora (también turnos de noche)
    select distinct on (f.usuario_id) f.usuario_id, f.tipo
    from public.fichajes f where f.momento >= now() - interval '24 hours'
    order by f.usuario_id, f.momento desc, f.id desc
  ),
  persona as (
    select a.id,
      exists (select 1 from public.fichajes f where f.usuario_id = a.id and f.momento >= desde_hoy) as fichado,
      coalesce((select ul.tipo from ultimo ul where ul.usuario_id = a.id) in ('entrada', 'reanudar'), false) as trabajando,
      coalesce((select ul.tipo from ultimo ul where ul.usuario_id = a.id) = 'pausa', false) as en_pausa,
      exists (select 1 from public.ausencias au where au.usuario_id = a.id and au.estado = 'aprobada'
              and hoy between au.desde and au.hasta) as ausente,
      exists (select 1 from public.usuario_perfil up join public.perfiles pf on pf.id = up.perfil_id
              where up.usuario_id = a.id and 'chofer.usar' = any (pf.permisos)) as chofer,
      exists (select 1 from public.asignaciones s where s.usuario_id = a.id and s.fin is null) as con_camion
    from activos a
  ),
  centro as (
    select c.nombre,
      count(distinct p.id) as plantilla,
      count(distinct p.id) filter (where p.fichado) as fichados,
      count(distinct p.id) filter (where p.trabajando) as trabajando,
      count(distinct p.id) filter (where p.ausente) as ausentes,
      (select count(*) from public.ausencias au where au.estado = 'pendiente'
         and au.usuario_id in (select x.usuario_id from public.usuario_perfil x where x.centro_id = c.id)) as vacaciones_pendientes,
      (select count(*) from public.solicitudes_ropa sr where sr.estado = 'pendiente'
         and sr.usuario_id in (select x.usuario_id from public.usuario_perfil x where x.centro_id = c.id)) as ropa_pendiente,
      (select count(distinct x.usuario_id) from public.usuario_perfil x join public.perfiles pf on pf.id = x.perfil_id
         join public.usuarios u on u.id = x.usuario_id and u.activo
         where x.centro_id = c.id and 'ausencias.aprobar' = any (pf.permisos)) as responsables
    from public.centros c
    left join public.usuario_perfil up on up.centro_id = c.id
    left join persona p on p.id = up.usuario_id
    where c.activo
    group by c.id, c.nombre
  ),
  cad as (select * from public.resumen_caducidades(30, false))
  select jsonb_build_object(
    'hoy', hoy,
    'plantilla', (select count(*) from persona),
    'fichados', (select count(*) from persona where fichado),
    'trabajando', (select count(*) from persona where trabajando),
    'en_pausa', (select count(*) from persona where en_pausa),
    'ausentes', (select count(*) from persona where ausente),
    'choferes', (select count(*) from persona where chofer),
    'choferes_trabajando', (select count(*) from persona where chofer and trabajando),
    'choferes_con_camion', (select count(*) from persona where chofer and con_camion),
    'por_puesto', (select coalesce(jsonb_agg(jsonb_build_object('puesto', x.nombre, 'n', x.n) order by x.n desc, x.nombre), '[]'::jsonb)
                   from (select pf.nombre, count(distinct up.usuario_id) as n
                         from public.usuario_perfil up join public.perfiles pf on pf.id = up.perfil_id
                         join public.usuarios u on u.id = up.usuario_id and u.activo group by pf.nombre) x),
    'centros', (select coalesce(jsonb_agg(to_jsonb(c) order by c.nombre), '[]'::jsonb) from centro c),
    'sin_centro', (select count(distinct up.usuario_id) from public.usuario_perfil up
                   join public.perfiles pf on pf.id = up.perfil_id and not pf.todos_los_centros
                   join public.usuarios u on u.id = up.usuario_id and u.activo where up.centro_id is null),
    'pendientes', jsonb_build_object(
      'vacaciones', (select count(*) from public.ausencias where estado = 'pendiente'),
      'ropa', (select count(*) from public.solicitudes_ropa where estado = 'pendiente'),
      'ropa_entregar', (select count(*) from public.solicitudes_ropa where estado = 'aprobada'),
      'por_configurar', (select count(*) from public.usuarios u where not u.es_admin
                         and not exists (select 1 from public.usuario_perfil up where up.usuario_id = u.id)),
      'odoo_error', (select count(*) from public.fichajes where odoo_estado in ('error', 'sin_empleado'))
                    + (select count(*) from public.ausencias where odoo_estado in ('error', 'sin_empleado'))),
    'seguridad', (select jsonb_build_object('caducados', cad.caducados, 'pronto', cad.pronto, 'faltan', cad.faltan) from cad),
    'incidencias', jsonb_build_object(
      'abiertas', (select count(*) from public.incidencias where estado <> 'cerrada'),
      'graves', (select count(*) from public.incidencias where estado <> 'cerrada' and gravedad <> 'leve'),
      'mes', (select count(*) from public.incidencias where ocurrio >= date_trunc('month', hoy)::timestamp at time zone 'Europe/Madrid'))
  ) into resultado;
  return resultado;
end;
$$;
revoke all on function public.resumen_direccion() from public, anon;
grant execute on function public.resumen_direccion() to authenticated;
