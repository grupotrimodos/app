-- Cuadro de mando de dirección, versión 2: además de lo de antes, chóferes por zona (cliente o ruta), ropa de la
-- temporada, comparaciones (presencia de los últimos 14 días, días de ausencia e incidencias frente al mes anterior
-- hasta el mismo día) y el id de cada centro (para unirlo con sus cifras de Odoo). Sigue devolviendo SOLO totales.
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
  mes date := date_trunc('month', hoy)::date;
  mes_ant date := (date_trunc('month', hoy) - interval '1 month')::date;
  -- mismo día del mes anterior (o su último día si ese mes es más corto)
  hasta_ant date := least(mes_ant + (hoy - mes), mes - 1);
  t_ropa text := public.temporada_ropa(hoy);
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
  docs_mal as (   -- personas con algún documento obligatorio de su puesto caducado o sin apuntar
    select distinct up.usuario_id
    from public.usuario_perfil up
    join public.perfiles pf on pf.id = up.perfil_id
    cross join unnest(pf.documentos) as d (tipo)
    left join public.documentos doc on doc.usuario_id = up.usuario_id and doc.tipo = d.tipo
    where doc.id is null or doc.caduca < hoy
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
      exists (select 1 from public.asignaciones s where s.usuario_id = a.id and s.fin is null) as con_camion,
      exists (select 1 from docs_mal dm where dm.usuario_id = a.id) as documentacion_mal
    from activos a
  ),
  centro as (
    select c.id, c.nombre,
      count(distinct p.id) as plantilla,
      count(distinct p.id) filter (where p.fichado) as fichados,
      count(distinct p.id) filter (where p.trabajando) as trabajando,
      count(distinct p.id) filter (where p.ausente) as ausentes,
      count(distinct p.id) filter (where p.chofer) as choferes,
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
  zona as (
    select zo.id, zo.nombre, zo.tipo,
      count(p.id) as choferes,
      count(p.id) filter (where p.trabajando) as trabajando,
      count(p.id) filter (where p.fichado) as fichados,
      count(p.id) filter (where p.ausente) as ausentes,
      count(p.id) filter (where p.con_camion) as con_camion,
      count(p.id) filter (where p.documentacion_mal) as documentacion
    from public.zonas zo
    left join public.chofer_zona cz on cz.zona_id = zo.id
    left join persona p on p.id = cz.usuario_id and p.chofer
    where zo.activo
    group by zo.id, zo.nombre, zo.tipo
  ),
  dias as (   -- personas distintas que han fichado cada día de los últimos 14 (día de Madrid)
    select g.dia::date as dia,
      (select count(distinct f.usuario_id) from public.fichajes f
        where f.momento >= (g.dia::timestamp at time zone 'Europe/Madrid')
          and f.momento < ((g.dia + interval '1 day')::timestamp at time zone 'Europe/Madrid')) as n
    from generate_series(hoy - 13, hoy, interval '1 day') as g (dia)
  ),
  dotacion as (
    select d.estado,
      coalesce(jsonb_typeof(tr.tallas) = 'object' and tr.tallas <> '{}'::jsonb, false) as con_tallas
    from public.ropa_dotaciones d
    join public.usuarios u on u.id = d.usuario_id and u.activo
    left join public.tallas_ropa tr on tr.usuario_id = d.usuario_id
    where d.temporada = t_ropa
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
    'choferes_sin_zona', (select count(*) from persona p where p.chofer
                          and not exists (select 1 from public.chofer_zona cz join public.zonas zo on zo.id = cz.zona_id and zo.activo
                                          where cz.usuario_id = p.id)),
    'altas_mes', (select count(*) from public.usuarios u where u.activo and u.creado >= (mes::timestamp at time zone 'Europe/Madrid')),
    'por_puesto', (select coalesce(jsonb_agg(jsonb_build_object('puesto', x.nombre, 'n', x.n, 'pantalla', x.pantalla)
                                             order by x.n desc, x.nombre), '[]'::jsonb)
                   from (select pf.nombre, pf.pantalla, count(distinct up.usuario_id) as n
                         from public.usuario_perfil up join public.perfiles pf on pf.id = up.perfil_id
                         join public.usuarios u on u.id = up.usuario_id and u.activo group by pf.nombre, pf.pantalla) x),
    'centros', (select coalesce(jsonb_agg(to_jsonb(c) order by c.nombre), '[]'::jsonb) from centro c),
    'zonas', (select coalesce(jsonb_agg(to_jsonb(z) order by z.choferes desc, z.nombre), '[]'::jsonb) from zona z),
    'fichados_dias', (select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'n', d.n) order by d.dia), '[]'::jsonb) from dias d),
    'sin_centro', (select count(distinct up.usuario_id) from public.usuario_perfil up
                   join public.perfiles pf on pf.id = up.perfil_id and not pf.todos_los_centros
                   join public.usuarios u on u.id = up.usuario_id and u.activo where up.centro_id is null),
    'ausencias', jsonb_build_object(   -- días de ausencia aprobados dentro de cada ventana (persona × día)
      'dias_mes', (select coalesce(sum(greatest(0, least(au.hasta, hoy) - greatest(au.desde, mes) + 1)), 0)
                   from public.ausencias au where au.estado = 'aprobada' and au.desde <= hoy and au.hasta >= mes),
      'dias_mes_anterior', (select coalesce(sum(greatest(0, least(au.hasta, hasta_ant) - greatest(au.desde, mes_ant) + 1)), 0)
                            from public.ausencias au where au.estado = 'aprobada' and au.desde <= hasta_ant and au.hasta >= mes_ant)),
    'pendientes', jsonb_build_object(
      'vacaciones', (select count(*) from public.ausencias where estado = 'pendiente'),
      'ropa', (select count(*) from public.solicitudes_ropa where estado = 'pendiente'),
      'ropa_entregar', (select count(*) from public.solicitudes_ropa where estado = 'aprobada'),
      'ropa_temporada', (select count(*) from dotacion where estado = 'por_entregar'),
      'por_configurar', (select count(*) from public.usuarios u where not u.es_admin
                         and not exists (select 1 from public.usuario_perfil up where up.usuario_id = u.id)),
      'odoo_error', (select count(*) from public.fichajes where odoo_estado in ('error', 'sin_empleado'))
                    + (select count(*) from public.ausencias where odoo_estado in ('error', 'sin_empleado'))),
    'ropa', jsonb_build_object(
      'temporada', t_ropa,
      'personas', (select count(*) from dotacion),
      'por_entregar', (select count(*) from dotacion where estado = 'por_entregar'),
      'entregadas', (select count(*) from dotacion where estado <> 'por_entregar'),
      'sin_tallas', (select count(*) from dotacion where estado = 'por_entregar' and not con_tallas),
      'cambios', (select count(*) from public.solicitudes_ropa where estado in ('pendiente', 'aprobada'))),
    'seguridad', (select jsonb_build_object('caducados', cad.caducados, 'pronto', cad.pronto, 'faltan', cad.faltan) from cad),
    'incidencias', jsonb_build_object(
      'abiertas', (select count(*) from public.incidencias where estado <> 'cerrada'),
      'graves', (select count(*) from public.incidencias where estado <> 'cerrada' and gravedad <> 'leve'),
      'mes', (select count(*) from public.incidencias where ocurrio >= (mes::timestamp at time zone 'Europe/Madrid')),
      'mes_anterior', (select count(*) from public.incidencias where ocurrio >= (mes_ant::timestamp at time zone 'Europe/Madrid')
                         and ocurrio < ((hasta_ant + 1)::timestamp at time zone 'Europe/Madrid')))
  ) into resultado;
  return resultado;
end;
$$;
revoke all on function public.resumen_direccion() from public, anon;
grant execute on function public.resumen_direccion() to authenticated;
