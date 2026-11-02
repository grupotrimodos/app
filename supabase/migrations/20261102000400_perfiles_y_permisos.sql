-- Perfiles configurables: el administrador crea perfiles (Chófer, Operario de almacén, Jefe de tráfico, RR. HH.…),
-- marca qué permisos tiene cada uno (catálogo en src/lib/permisos.json) y los asigna a las personas por centro.
-- Sustituye a usuarios.modulos y a la tabla usuario_centro_rol (sus datos se migran).
-- «es_admin» queda como SUPERADMINISTRADOR: tiene todos los permisos en todos los centros.

-- ---------------------------------------------------------------- tablas
create table public.perfiles (
  id                bigint generated always as identity primary key,
  nombre            text not null unique,
  descripcion       text,
  permisos          text[] not null default '{}',
  todos_los_centros boolean not null default false,   -- sus permisos sobre otras personas valen en todos los centros
  creado            timestamptz not null default now()
);

create table public.usuario_perfil (
  id         bigint generated always as identity primary key,
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  perfil_id  bigint not null references public.perfiles (id) on delete cascade,
  centro_id  bigint references public.centros (id) on delete cascade,   -- null: sin centro concreto
  constraint usuario_perfil_unico unique nulls not distinct (usuario_id, perfil_id, centro_id)
);
create index usuario_perfil_usuario_idx on public.usuario_perfil (usuario_id);
create index usuario_perfil_perfil_idx on public.usuario_perfil (perfil_id);
create index usuario_perfil_centro_idx on public.usuario_perfil (centro_id);

-- ---------------------------------------------------------------- funciones de permisos
-- ¿Tengo este permiso en algún perfil? (superadmin: siempre)
create or replace function privado.tengo_permiso(permiso text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select u.activo and (u.es_admin or exists (
      select 1 from public.usuario_perfil up join public.perfiles pf on pf.id = up.perfil_id
      where up.usuario_id = u.id and permiso = any (pf.permisos)))
    from public.usuarios u where u.id = (select auth.uid())), false);
$$;

-- ¿Puedo ejercer este permiso SOBRE esta persona? Superadmin; o un perfil mío con el permiso que valga en todos
-- los centros; o en un centro en el que esa persona tenga algún perfil.
create or replace function privado.puedo_sobre(permiso text, objetivo uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select u.activo and (u.es_admin or exists (
      select 1 from public.usuario_perfil up join public.perfiles pf on pf.id = up.perfil_id
      where up.usuario_id = u.id and permiso = any (pf.permisos)
        and (pf.todos_los_centros or exists (
          select 1 from public.usuario_perfil o where o.usuario_id = objetivo and o.centro_id = up.centro_id))))
    from public.usuarios u where u.id = (select auth.uid())), false);
$$;

revoke all on function privado.tengo_permiso(text), privado.puedo_sobre(text, uuid) from public, anon;
grant execute on function privado.tengo_permiso(text), privado.puedo_sobre(text, uuid) to authenticated;

-- Mis permisos (para la web y la API Python). Con los permisos del propio usuario: solo ve lo suyo.
create or replace function public.mis_permisos()
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(distinct p order by p), '{}')
  from public.usuario_perfil up
  join public.perfiles pf on pf.id = up.perfil_id
  cross join lateral unnest(pf.permisos) as p
  where up.usuario_id = (select auth.uid());
$$;
revoke all on function public.mis_permisos() from public, anon;
grant execute on function public.mis_permisos() to authenticated;

-- ---------------------------------------------------------------- migración de datos
insert into public.perfiles (nombre, descripcion, permisos) values
  ('Chófer', 'Conductores', '{fichaje.fichar,chofer.usar,ausencias.pedir,deca.usar}'),
  ('Operario', 'Operarios de almacén', '{fichaje.fichar,ausencias.pedir}'),
  ('Oficina', 'Personal de oficina', '{fichaje.fichar,ausencias.pedir}'),
  ('Responsable', 'Responsable de centro: ve a su equipo, aprueba ausencias y corrige fichajes',
   '{fichaje.fichar,ausencias.pedir,equipo.ver,fichaje.corregir,ausencias.aprobar}');

insert into public.usuario_perfil (usuario_id, perfil_id, centro_id)
select ucr.usuario_id, pf.id, ucr.centro_id
from public.usuario_centro_rol ucr
join public.perfiles pf on pf.nombre = case ucr.rol when 'chofer' then 'Chófer' when 'operario' then 'Operario'
                                                    when 'oficina' then 'Oficina' else 'Responsable' end
on conflict do nothing;

-- ---------------------------------------------------------------- se retiran módulos y roles fijos
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('centros', 'usuarios', 'usuario_centro_rol', 'fichajes', 'ausencias', 'vehiculos', 'asignaciones')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

drop table public.usuario_centro_rol;
alter table public.usuarios drop column modulos;
drop function privado.puede_gestionar(uuid);
drop function privado.tiene_modulo(text);

-- Solo un superadministrador nombra superadministradores o cambia la ficha de otro superadministrador
-- (quien solo tiene «admin.usuarios» no puede desactivarlo ni nombrarse a sí mismo).
create or replace function privado.proteger_superadmin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Solo afecta a los usuarios de la app; el editor SQL de Supabase y la clave de servidor pueden (primer superadmin).
  if current_user in ('authenticated', 'anon') and (old.es_admin or new.es_admin) and not (select privado.es_admin()) then
    raise exception 'Solo un superadministrador puede cambiar a un superadministrador';
  end if;
  return new;
end;
$$;
revoke all on function privado.proteger_superadmin() from public, anon, authenticated;
create trigger usuarios_proteger_superadmin before update on public.usuarios
  for each row execute function privado.proteger_superadmin();

-- ---------------------------------------------------------------- permisos (RLS)
alter table public.perfiles       enable row level security;
alter table public.usuario_perfil enable row level security;
revoke all on public.perfiles, public.usuario_perfil from anon;
grant select, insert, update, delete on public.perfiles, public.usuario_perfil to authenticated;

create policy "perfiles: los ve cualquier usuario" on public.perfiles for select to authenticated using (true);
create policy "perfiles: alta" on public.perfiles for insert to authenticated with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "perfiles: cambio" on public.perfiles for update to authenticated
  using ((select privado.tengo_permiso('admin.usuarios'))) with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "perfiles: baja" on public.perfiles for delete to authenticated using ((select privado.tengo_permiso('admin.usuarios')));

create policy "usuario_perfil: los propios, los de su equipo y admin" on public.usuario_perfil for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puedo_sobre('equipo.ver', usuario_id))
         or (select privado.puedo_sobre('ausencias.aprobar', usuario_id)) or (select privado.puedo_sobre('fichaje.corregir', usuario_id))
         or (select privado.tengo_permiso('admin.usuarios')));
create policy "usuario_perfil: alta" on public.usuario_perfil for insert to authenticated with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "usuario_perfil: cambio" on public.usuario_perfil for update to authenticated
  using ((select privado.tengo_permiso('admin.usuarios'))) with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "usuario_perfil: baja" on public.usuario_perfil for delete to authenticated using ((select privado.tengo_permiso('admin.usuarios')));

create policy "centros: los ve cualquier usuario" on public.centros for select to authenticated using (true);
create policy "centros: alta" on public.centros for insert to authenticated with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "centros: cambio" on public.centros for update to authenticated
  using ((select privado.tengo_permiso('admin.usuarios'))) with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "centros: baja" on public.centros for delete to authenticated using ((select privado.tengo_permiso('admin.usuarios')));

create policy "usuarios: la propia, las de su equipo y admin" on public.usuarios for select to authenticated
  using (id = (select auth.uid()) or (select privado.puedo_sobre('equipo.ver', id))
         or (select privado.puedo_sobre('ausencias.aprobar', id)) or (select privado.puedo_sobre('fichaje.corregir', id))
         or (select privado.tengo_permiso('admin.usuarios')));
create policy "usuarios: cambio solo admin" on public.usuarios for update to authenticated
  using ((select privado.tengo_permiso('admin.usuarios'))) with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "usuarios: baja solo admin" on public.usuarios for delete to authenticated
  using ((select privado.tengo_permiso('admin.usuarios')));

create policy "vehiculos: los ve cualquier usuario" on public.vehiculos for select to authenticated using (true);
create policy "vehiculos: alta" on public.vehiculos for insert to authenticated with check ((select privado.tengo_permiso('vehiculos.gestionar')));
create policy "vehiculos: cambio" on public.vehiculos for update to authenticated
  using ((select privado.tengo_permiso('vehiculos.gestionar'))) with check ((select privado.tengo_permiso('vehiculos.gestionar')));
create policy "vehiculos: baja" on public.vehiculos for delete to authenticated using ((select privado.tengo_permiso('vehiculos.gestionar')));

create policy "fichajes: los propios y los de su equipo" on public.fichajes for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puedo_sobre('equipo.ver', usuario_id))
         or (select privado.puedo_sobre('fichaje.corregir', usuario_id)));
create policy "fichajes: fichar uno mismo, en el momento" on public.fichajes for insert to authenticated
  with check (
    usuario_id = (select auth.uid()) and creado_por = (select auth.uid()) and origen in ('app', 'camion')
    and momento between now() - interval '2 minutes' and now() + interval '1 minute'
    and odoo_estado = 'pendiente'
    and ((select privado.tengo_permiso('fichaje.fichar')) or (origen = 'camion' and (select privado.tengo_permiso('chofer.usar'))))
  );
create policy "fichajes: correcciones" on public.fichajes for insert to authenticated
  with check (
    origen = 'correccion' and creado_por = (select auth.uid()) and usuario_id <> (select auth.uid())
    and momento <= now() and odoo_estado = 'pendiente' and (select privado.puedo_sobre('fichaje.corregir', usuario_id))
  );
create policy "fichajes: estado de envío a Odoo" on public.fichajes for update to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puedo_sobre('fichaje.corregir', usuario_id)))
  with check (usuario_id = (select auth.uid()) or (select privado.puedo_sobre('fichaje.corregir', usuario_id)));

create policy "ausencias: las propias y las de su equipo" on public.ausencias for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puedo_sobre('equipo.ver', usuario_id))
         or (select privado.puedo_sobre('ausencias.aprobar', usuario_id)));
create policy "ausencias: pedir para uno mismo" on public.ausencias for insert to authenticated
  with check (
    usuario_id = (select auth.uid()) and estado = 'pendiente' and resuelto_por is null and odoo_estado = 'pendiente'
    and (select privado.tengo_permiso('ausencias.pedir'))
  );
create policy "ausencias: anular la propia o resolver las del equipo" on public.ausencias for update to authenticated
  using (
    (usuario_id = (select auth.uid()) and estado = 'pendiente')
    or (usuario_id <> (select auth.uid()) and (select privado.puedo_sobre('ausencias.aprobar', usuario_id))
        and (estado = 'pendiente' or (estado = 'aprobada' and resuelto_por = (select auth.uid()))))
  )
  with check (
    (usuario_id = (select auth.uid()) and estado in ('pendiente', 'anulada') and resuelto_por is null)
    or (usuario_id <> (select auth.uid()) and (select privado.puedo_sobre('ausencias.aprobar', usuario_id))
        and estado in ('aprobada', 'rechazada') and resuelto_por = (select auth.uid()))
  );

create policy "asignaciones: las propias y las de su equipo" on public.asignaciones for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puedo_sobre('equipo.ver', usuario_id)));
create policy "asignaciones: abrir la propia o corregir las del equipo" on public.asignaciones for insert to authenticated
  with check (
    (usuario_id = (select auth.uid()) and origen in ('tacografo', 'manual') and fin is null
      and inicio between now() - interval '2 minutes' and now() + interval '1 minute'
      and (select privado.tengo_permiso('chofer.usar')))
    or (origen = 'correccion' and usuario_id <> (select auth.uid()) and (select privado.puedo_sobre('fichaje.corregir', usuario_id)))
  );
create policy "asignaciones: cerrar la propia o las del equipo" on public.asignaciones for update to authenticated
  using (
    (usuario_id = (select auth.uid()) and fin is null)
    or (usuario_id <> (select auth.uid()) and (select privado.puedo_sobre('fichaje.corregir', usuario_id)))
  )
  with check (
    (usuario_id = (select auth.uid()) and fin is not null and fin <= now() + interval '1 minute')
    or (usuario_id <> (select auth.uid()) and (select privado.puedo_sobre('fichaje.corregir', usuario_id)))
  );
