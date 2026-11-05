-- Cuatro perfiles base (Administrador, Oficina, Chófer y Operario), cada uno con su pantalla; zonas de chóferes (por
-- cliente o ruta) y cuentas/etiquetas analíticas de Odoo de cada centro (para separar las cifras por centro).

-- ---------------------------------------------------------------- perfiles base y pantalla
-- pantalla: qué ve al entrar quien tiene el perfil. 'direccion' (cuadro de mando), 'oficina' (espacio de gestión) o
-- 'campo' (una sola pantalla en el móvil). Null = complemento (Responsable, Seguridad): se suma a un puesto.
-- Si alguien tiene varios, manda el de más alcance: dirección > oficina > campo.
alter table public.perfiles
  add column pantalla text check (pantalla in ('direccion', 'oficina', 'campo')),
  add column base boolean not null default false;   -- los cuatro imprescindibles: no se borran ni cambian de nombre

update public.perfiles set pantalla = 'oficina', base = true where nombre = 'Oficina';
update public.perfiles set pantalla = 'campo', base = true where nombre in ('Chófer', 'Operario');
-- Operarios: fichar y su ropa de trabajo (la dotación de temporada llega sola). Ampliable desde Administración.
update public.perfiles set permisos = '{fichaje.fichar,ropa.pedir}', descripcion = 'Operarios de los centros de montaje: fichan y reciben su ropa de trabajo'
 where nombre = 'Operario';
update public.perfiles set descripcion = 'Conductores: fichan, su camión, sus órdenes de transporte, su documentación y su ropa'
 where nombre = 'Chófer';
update public.perfiles set descripcion = 'Personal de oficina: su jornada, la flota y las órdenes de transporte'
 where nombre = 'Oficina';

insert into public.perfiles (nombre, descripcion, permisos, todos_los_centros, pantalla, base) values
  ('Administrador', 'Dirección y administración: cuadro de mando de toda la empresa, finanzas, personas, seguridad y configuración',
   '{direccion.ver,direccion.finanzas,equipo.ver,ausencias.aprobar,fichaje.corregir,zonas.gestionar,ropa.gestionar,ropa.configurar,seguridad.ver,seguridad.gestionar,admin.usuarios,vehiculos.gestionar,admin.sincronizacion}',
   true, 'direccion', true)
on conflict (nombre) do update set pantalla = 'direccion', base = true, todos_los_centros = true,
  permisos = array(select distinct unnest(public.perfiles.permisos || excluded.permisos));

-- Los superadministradores tienen además el perfil Administrador (así su pantalla y su menú salen del perfil).
insert into public.usuario_perfil (usuario_id, perfil_id, centro_id)
select u.id, pf.id, null from public.usuarios u, public.perfiles pf
where u.es_admin and u.activo and pf.nombre = 'Administrador'
on conflict do nothing;

create or replace function privado.proteger_perfil_base()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.base then raise exception 'El perfil «%» es uno de los cuatro básicos y no se puede borrar', old.nombre; end if;
    return old;
  end if;
  if old.base and (new.nombre <> old.nombre or not new.base or new.pantalla is distinct from old.pantalla) then
    raise exception 'El perfil «%» es uno de los cuatro básicos: no cambia de nombre ni de pantalla', old.nombre;
  end if;
  return new;
end;
$$;
revoke all on function privado.proteger_perfil_base() from public, anon, authenticated;
create trigger perfiles_proteger_base before update or delete on public.perfiles
  for each row execute function privado.proteger_perfil_base();

-- ---------------------------------------------------------------- zonas de chóferes (por cliente o ruta)
create table public.zonas (
  id          bigint generated always as identity primary key,
  nombre      text not null unique check (char_length(nombre) between 2 and 80),
  tipo        text not null default 'cliente' check (tipo in ('cliente', 'ruta')),
  descripcion text check (char_length(descripcion) <= 200),
  activo      boolean not null default true,
  creado      timestamptz not null default now()
);

create table public.chofer_zona (
  usuario_id   uuid primary key references public.usuarios (id) on delete cascade,
  zona_id      bigint not null references public.zonas (id) on delete cascade,
  asignado_por uuid default auth.uid() references public.usuarios (id) on delete set null,
  asignado_en  timestamptz not null default now()
);
create index chofer_zona_zona_idx on public.chofer_zona (zona_id);
create index chofer_zona_asignado_por_idx on public.chofer_zona (asignado_por);

alter table public.zonas enable row level security;
alter table public.chofer_zona enable row level security;
revoke all on public.zonas, public.chofer_zona from anon;
grant select, insert, update on public.zonas to authenticated;
grant select, insert, update, delete on public.chofer_zona to authenticated;

create policy "zonas: las ve cualquier usuario" on public.zonas for select to authenticated using (true);
create policy "zonas: alta" on public.zonas for insert to authenticated with check ((select privado.tengo_permiso('zonas.gestionar')));
create policy "zonas: cambio" on public.zonas for update to authenticated
  using ((select privado.tengo_permiso('zonas.gestionar'))) with check ((select privado.tengo_permiso('zonas.gestionar')));

create policy "chofer_zona: la propia, la de su equipo y dirección" on public.chofer_zona for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puedo_sobre('equipo.ver', usuario_id))
         or (select privado.puedo_sobre('zonas.gestionar', usuario_id)) or (select privado.tengo_permiso('direccion.ver')));
create policy "chofer_zona: asignar" on public.chofer_zona for insert to authenticated
  with check ((select privado.puedo_sobre('zonas.gestionar', usuario_id)));
create policy "chofer_zona: cambiar" on public.chofer_zona for update to authenticated
  using ((select privado.puedo_sobre('zonas.gestionar', usuario_id))) with check ((select privado.puedo_sobre('zonas.gestionar', usuario_id)));
create policy "chofer_zona: quitar" on public.chofer_zona for delete to authenticated
  using ((select privado.puedo_sobre('zonas.gestionar', usuario_id)));

-- Quien organiza las zonas necesita ver el nombre de los chóferes de sus centros.
create policy "usuarios: los ve quien organiza sus zonas" on public.usuarios for select to authenticated
  using ((select privado.puedo_sobre('zonas.gestionar', id)));
create policy "usuario_perfil: los ve quien organiza zonas" on public.usuario_perfil for select to authenticated
  using ((select privado.puedo_sobre('zonas.gestionar', usuario_id)));

-- ---------------------------------------------------------------- centros ↔ analítica de Odoo
-- Qué cuentas o etiquetas analíticas de Odoo son de cada centro: con ellas el cuadro de mando separa ingresos, gastos y
-- margen por centro (la procedencia va en la analítica del viaje y de la factura).
create table public.centro_analitica (
  id        bigint generated always as identity primary key,
  centro_id bigint not null references public.centros (id) on delete cascade,
  tipo      text not null check (tipo in ('cuenta', 'etiqueta')),
  odoo_id   integer not null check (odoo_id > 0),
  nombre    text not null check (char_length(nombre) between 1 and 200),
  creado    timestamptz not null default now(),
  constraint centro_analitica_unica unique (tipo, odoo_id)   -- una cuenta o etiqueta es de un solo centro
);
create index centro_analitica_centro_idx on public.centro_analitica (centro_id);

alter table public.centro_analitica enable row level security;
revoke all on public.centro_analitica from anon;
grant select, insert, delete on public.centro_analitica to authenticated;
create policy "centro_analitica: la ve dirección y administración" on public.centro_analitica for select to authenticated
  using ((select privado.tengo_permiso('direccion.finanzas')) or (select privado.tengo_permiso('admin.usuarios')));
create policy "centro_analitica: alta" on public.centro_analitica for insert to authenticated
  with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "centro_analitica: baja" on public.centro_analitica for delete to authenticated
  using ((select privado.tengo_permiso('admin.usuarios')));
