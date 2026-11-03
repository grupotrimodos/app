-- Normas claras: cada persona ve QUIÉN le aprueba sus vacaciones y su ropa (los responsables de sus centros con ese
-- permiso, o los que lo tienen en todos los centros). Si no hay nadie, la pantalla dice que lo aprueba la administración.
-- Solo devuelve nombres y centros, solo de quien puede aprobar a quien pregunta, y solo para estos dos permisos.
create or replace function public.quien_me_aprueba(permiso text)
returns table (nombre text, centro text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct coalesce(nullif(u.nombre, ''), u.codigo, u.email) as nombre, coalesce(c.nombre, 'todos los centros') as centro
  from public.usuario_perfil up
  join public.perfiles pf on pf.id = up.perfil_id and permiso = any (pf.permisos)
  join public.usuarios u on u.id = up.usuario_id and u.activo and u.id <> (select auth.uid())
  left join public.centros c on c.id = up.centro_id
  where permiso in ('ausencias.aprobar', 'ropa.gestionar')
    and (pf.todos_los_centros or exists (
      select 1 from public.usuario_perfil yo where yo.usuario_id = (select auth.uid()) and yo.centro_id = up.centro_id));
$$;
revoke all on function public.quien_me_aprueba(text) from public, anon;
grant execute on function public.quien_me_aprueba(text) to authenticated;
