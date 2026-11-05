-- Ropa de trabajo por temporada: cada puesto tiene su «muda» de verano y de invierno y cuántas mudas tocan (2). Al
-- empezar la temporada a cada persona se le prepara su dotación sola (no la tiene que pedir); con sus tallas, su
-- responsable sabe qué preparar y la marca como entregada, y la persona confirma que la ha recibido.
-- Las solicitudes sueltas (solicitudes_ropa) quedan para cambios: rotura, talla equivocada o pérdida.
--
-- Temporadas: verano del 1 de abril al 30 de septiembre; invierno del 1 de octubre al 31 de marzo.
-- Se nombran «2027-verano» y «2026-invierno» (el invierno lleva el año en que empieza).

create or replace function public.temporada_ropa(dia date default (now() at time zone 'Europe/Madrid')::date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when extract(month from dia) between 4 and 9 then extract(year from dia)::int || '-verano'
    when extract(month from dia) >= 10 then extract(year from dia)::int || '-invierno'
    else (extract(year from dia)::int - 1) || '-invierno'
  end;
$$;
grant execute on function public.temporada_ropa(date) to authenticated;

-- ---------------------------------------------------------------- composición por puesto
create table public.ropa_kits (
  id        bigint generated always as identity primary key,
  perfil_id bigint not null references public.perfiles (id) on delete cascade,
  temporada text not null check (temporada in ('verano', 'invierno')),
  -- UNA muda: [{"prenda": "polo", "cantidad": 1}, …] (catálogo de prendas en src/lib/ropa.ts)
  prendas   jsonb not null default '[]' check (jsonb_typeof(prendas) = 'array' and jsonb_array_length(prendas) <= 20),
  mudas     smallint not null default 2 check (mudas between 0 and 6),
  constraint ropa_kit_unico unique (perfil_id, temporada)
);

-- ---------------------------------------------------------------- tallas de cada persona
create table public.tallas_ropa (
  usuario_id  uuid primary key references public.usuarios (id) on delete cascade,
  tallas      jsonb not null default '{}' check (jsonb_typeof(tallas) = 'object'),   -- {"polo": "L", "pantalon": "44"}
  actualizado timestamptz not null default now()
);

-- ---------------------------------------------------------------- dotación de cada persona y temporada
create table public.ropa_dotaciones (
  id            bigint generated always as identity primary key,
  usuario_id    uuid not null references public.usuarios (id) on delete restrict,
  temporada     text not null check (temporada ~ '^[0-9]{4}-(verano|invierno)$'),
  prendas       jsonb not null check (jsonb_typeof(prendas) = 'array'),   -- total de la temporada (muda × mudas)
  estado        text not null default 'por_entregar' check (estado in ('por_entregar', 'entregada', 'recibida')),
  tallas        jsonb,                                                    -- con qué tallas se entregó
  entregado_por uuid references public.usuarios (id) on delete restrict,
  entregado_en  timestamptz,
  recibido_en   timestamptz,
  creado        timestamptz not null default now(),
  constraint dotacion_unica unique (usuario_id, temporada),
  constraint dotacion_coherente check ((estado = 'por_entregar') = (entregado_en is null)
                                       and (estado = 'recibida') = (recibido_en is not null))
);
create index ropa_dotaciones_temporada_idx on public.ropa_dotaciones (temporada, estado);
create index ropa_dotaciones_entregado_por_idx on public.ropa_dotaciones (entregado_por);

-- ---------------------------------------------------------------- RLS
alter table public.ropa_kits enable row level security;
alter table public.tallas_ropa enable row level security;
alter table public.ropa_dotaciones enable row level security;
revoke all on public.ropa_kits, public.tallas_ropa, public.ropa_dotaciones from anon;
grant select, insert, update on public.ropa_kits to authenticated;
grant select, insert, update on public.tallas_ropa to authenticated;
grant select on public.ropa_dotaciones to authenticated;   -- se crean y cambian solo con las funciones de abajo

create policy "ropa_kits: los ve cualquier usuario" on public.ropa_kits for select to authenticated using (true);
create policy "ropa_kits: alta" on public.ropa_kits for insert to authenticated with check ((select privado.tengo_permiso('ropa.configurar')));
create policy "ropa_kits: cambio" on public.ropa_kits for update to authenticated
  using ((select privado.tengo_permiso('ropa.configurar'))) with check ((select privado.tengo_permiso('ropa.configurar')));

create policy "tallas: las propias y las de su equipo" on public.tallas_ropa for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puedo_sobre('ropa.gestionar', usuario_id)));
create policy "tallas: apuntar las propias o las de su equipo" on public.tallas_ropa for insert to authenticated
  with check (usuario_id = (select auth.uid()) or (select privado.puedo_sobre('ropa.gestionar', usuario_id)));
create policy "tallas: cambiar las propias o las de su equipo" on public.tallas_ropa for update to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puedo_sobre('ropa.gestionar', usuario_id)))
  with check (usuario_id = (select auth.uid()) or (select privado.puedo_sobre('ropa.gestionar', usuario_id)));

create policy "dotaciones: las propias y las de su equipo" on public.ropa_dotaciones for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puedo_sobre('ropa.gestionar', usuario_id)));

-- ---------------------------------------------------------------- funciones
-- Prepara las dotaciones de la temporada en curso a quien le toquen (por los perfiles que tiene) y actualiza las que
-- aún no se han entregado si ha cambiado la composición. No hace nada que no estuviera ya decidido: se puede llamar
-- tantas veces como se quiera (la app la llama al abrir la ropa). Si alguien tiene dos puestos con ropa, de cada
-- prenda le toca la cantidad mayor.
create or replace function public.preparar_dotaciones()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t text := public.temporada_ropa();
  cambiadas integer;
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
  dotacion as (
    select usuario_id, jsonb_agg(jsonb_build_object('prenda', prenda, 'cantidad', cantidad) order by prenda) as prendas
    from lineas where cantidad > 0 group by usuario_id
  )
  insert into public.ropa_dotaciones (usuario_id, temporada, prendas)
  select usuario_id, t, prendas from dotacion
  on conflict (usuario_id, temporada) do update set prendas = excluded.prendas
    where public.ropa_dotaciones.estado = 'por_entregar' and public.ropa_dotaciones.prendas <> excluded.prendas;
  get diagnostics cambiadas = row_count;
  return cambiadas;
end;
$$;
revoke all on function public.preparar_dotaciones() from public, anon;
grant execute on function public.preparar_dotaciones() to authenticated;

-- El responsable de su centro (nunca la suya) la marca como entregada, con las tallas de ese momento, o deshace la
-- entrega mientras la persona no la haya confirmado.
create or replace function public.entregar_dotacion(dotacion bigint, entregada boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d public.ropa_dotaciones;
begin
  select * into d from public.ropa_dotaciones where id = dotacion for update;
  if d.id is null then raise exception 'No existe esa dotación' using errcode = 'P0002'; end if;
  if d.usuario_id = (select auth.uid()) or not (select privado.puedo_sobre('ropa.gestionar', d.usuario_id)) then
    raise exception 'No puedes entregar esta ropa' using errcode = '42501';
  end if;
  if entregada then
    if d.estado <> 'por_entregar' then raise exception 'Ya estaba entregada'; end if;
    update public.ropa_dotaciones set estado = 'entregada', entregado_por = (select auth.uid()), entregado_en = now(),
      tallas = (select tr.tallas from public.tallas_ropa tr where tr.usuario_id = d.usuario_id)
    where id = d.id;
  else
    if d.estado <> 'entregada' then raise exception 'Solo se puede deshacer una entrega que la persona no ha confirmado'; end if;
    update public.ropa_dotaciones set estado = 'por_entregar', entregado_por = null, entregado_en = null, tallas = null where id = d.id;
  end if;
end;
$$;
revoke all on function public.entregar_dotacion(bigint, boolean) from public, anon;
grant execute on function public.entregar_dotacion(bigint, boolean) to authenticated;

-- La persona confirma que la ha recibido.
create or replace function public.confirmar_dotacion(dotacion bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.ropa_dotaciones set estado = 'recibida', recibido_en = now()
  where id = dotacion and usuario_id = (select auth.uid()) and estado = 'entregada';
  if not found then raise exception 'Esta ropa no está pendiente de confirmar'; end if;
end;
$$;
revoke all on function public.confirmar_dotacion(bigint) from public, anon;
grant execute on function public.confirmar_dotacion(bigint) to authenticated;

-- ---------------------------------------------------------------- composición inicial (editable en Ropa → Composición)
insert into public.ropa_kits (perfil_id, temporada, prendas, mudas)
select pf.id, k.temporada, k.prendas::jsonb, 2
from public.perfiles pf
cross join (values
  ('verano', '[{"prenda": "polo", "cantidad": 1}, {"prenda": "pantalon", "cantidad": 1}]'),
  ('invierno', '[{"prenda": "camiseta", "cantidad": 1}, {"prenda": "forro", "cantidad": 1}, {"prenda": "pantalon", "cantidad": 1}]')
) as k (temporada, prendas)
where pf.nombre in ('Chófer', 'Operario')
on conflict (perfil_id, temporada) do nothing;
