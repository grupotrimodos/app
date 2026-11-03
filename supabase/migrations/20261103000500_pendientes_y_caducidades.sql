-- Que todo lo pendiente llegue a quien lo tiene que resolver, con las mismas cifras en el inicio y en cada pantalla.

-- 1. Quien gestiona la sincronización con Odoo ve los fichajes y las ausencias (si no, su aviso de «envíos con error»
--    contaba solo los suyos mientras la pantalla de sincronización, que lee con la clave de servidor, mostraba todos).
create policy "fichajes: los ve quien gestiona la sincronización" on public.fichajes for select to authenticated
  using ((select privado.tengo_permiso('admin.sincronizacion')));
create policy "ausencias: las ve quien gestiona la sincronización" on public.ausencias for select to authenticated
  using ((select privado.tengo_permiso('admin.sincronizacion')));

-- 2. Caducidades: el MISMO cálculo que el panel de Seguridad (documentos de camiones activos, documentación que pide el
--    puesto de cada persona activa y revisiones de carretillas), para que el aviso del inicio cuente también lo que
--    nadie ha apuntado. Con los permisos de quien pregunta (RLS): seguridad lo ve todo; quien gestiona camiones, los
--    camiones. Tipos de documento de vehículo: los de src/lib/seguridad.ts (DOCUMENTOS_VEHICULO).
create or replace function public.resumen_caducidades(dias integer default 30, solo_vehiculos boolean default false)
returns table (caducados integer, pronto integer, faltan integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with obligatorio as (
    select 'v' as clase, v.id::text as de, t.tipo
    from public.vehiculos v cross join unnest(array['itv', 'seguro', 'tacografo']) as t (tipo)
    where v.activo
    union
    select 'u', up.usuario_id::text, d.tipo
    from public.usuario_perfil up
    join public.perfiles pf on pf.id = up.perfil_id
    join public.usuarios u on u.id = up.usuario_id and u.activo
    cross join unnest(pf.documentos) as d (tipo)
    where not solo_vehiculos
  ),
  estado as (
    -- Un documento apuntado sin fecha no caduca (una formación); una carretilla sin fecha de revisión, falta.
    select 'documento' as origen, doc.id as hay, doc.caduca
    from obligatorio o
    left join public.documentos doc on doc.tipo = o.tipo
      and ((o.clase = 'v' and doc.vehiculo_id::text = o.de) or (o.clase = 'u' and doc.usuario_id::text = o.de))
    union all
    select 'equipo', e.id, e.proxima_revision from public.equipos e where e.activo and not solo_vehiculos
  )
  select count(*) filter (where hay is not null and caduca < current_date)::integer,
         count(*) filter (where hay is not null and caduca >= current_date and caduca <= current_date + dias)::integer,
         count(*) filter (where hay is null or (origen = 'equipo' and caduca is null))::integer
  from estado;
$$;
revoke all on function public.resumen_caducidades(integer, boolean) from public, anon;
grant execute on function public.resumen_caducidades(integer, boolean) to authenticated;
