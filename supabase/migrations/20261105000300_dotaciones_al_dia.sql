-- Las dotaciones de ropa por entregar reflejan siempre a quién le toca AHORA: si alguien se da de baja o pasa a un
-- puesto sin ropa, la suya (aún sin entregar) desaparece de la lista de entregas. Lo ya entregado no se toca nunca.
create or replace function public.preparar_dotaciones()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t text := public.temporada_ropa();
  cambios integer;
begin
  if (select auth.uid()) is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  with lineas as (
    select up.usuario_id, e->>'prenda' as prenda,
           max(case when e->>'cantidad' ~ '^[0-9]{1,2}$' then (e->>'cantidad')::int else 0 end * k.mudas) as cantidad
    from public.usuario_perfil up
    join public.usuarios u on u.id = up.usuario_id and u.activo
    join public.ropa_kits k on k.perfil_id = up.perfil_id and k.temporada = split_part(t, '-', 2)
    cross join lateral jsonb_array_elements(k.prendas) e
    where e->>'prenda' ~ '^[a-z_]{2,30}$'
    group by up.usuario_id, e->>'prenda'
  ),
  tocan as (
    select usuario_id, jsonb_agg(jsonb_build_object('prenda', prenda, 'cantidad', cantidad) order by prenda) as prendas
    from lineas where cantidad > 0 group by usuario_id
  ),
  puestas as (
    insert into public.ropa_dotaciones (usuario_id, temporada, prendas)
    select usuario_id, t, prendas from tocan
    on conflict (usuario_id, temporada) do update set prendas = excluded.prendas
      where public.ropa_dotaciones.estado = 'por_entregar' and public.ropa_dotaciones.prendas <> excluded.prendas
    returning 1
  ),
  retiradas as (
    delete from public.ropa_dotaciones d
    where d.temporada = t and d.estado = 'por_entregar'
      and not exists (select 1 from tocan x where x.usuario_id = d.usuario_id)
    returning 1
  )
  select (select count(*) from puestas) + (select count(*) from retiradas) into cambios;
  return cambios;
end;
$$;
revoke all on function public.preparar_dotaciones() from public, anon;
grant execute on function public.preparar_dotaciones() to authenticated;
