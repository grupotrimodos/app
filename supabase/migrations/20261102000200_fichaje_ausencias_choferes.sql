-- Fichaje, ausencias y módulo de chóferes.
-- Registro de jornada: los fichajes NO se borran ni se editan; los errores los corrige un responsable añadiendo
-- un fichaje de «corrección» con su nota. Solo se pueden actualizar los campos de envío a Odoo.

-- ---------------------------------------------------------------- funciones de permisos
-- ¿Puedo gestionar a este usuario? Administrador, o responsable de un centro en el que él tiene rol.
create or replace function privado.puede_gestionar(objetivo uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select privado.es_admin()) or exists (
    select 1
    from public.usuario_centro_rol yo
    join public.usuario_centro_rol el on el.centro_id = yo.centro_id
    join public.usuarios u on u.id = yo.usuario_id and u.activo
    where yo.usuario_id = (select auth.uid()) and yo.rol = 'responsable' and el.usuario_id = objetivo
  );
$$;

-- ¿El usuario actual está activo y tiene este módulo?
create or replace function privado.tiene_modulo(modulo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select u.activo and modulo = any (u.modulos) from public.usuarios u where u.id = (select auth.uid())), false);
$$;

revoke all on function privado.puede_gestionar(uuid), privado.tiene_modulo(text) from public, anon;
grant execute on function privado.puede_gestionar(uuid), privado.tiene_modulo(text) to authenticated;

-- Los responsables ven a las personas de sus centros (para el panel del equipo).
drop policy "usuarios: cada uno ve su fila y el admin todas" on public.usuarios;
create policy "usuarios: la propia y las de su equipo" on public.usuarios for select to authenticated
  using (id = (select auth.uid()) or (select privado.puede_gestionar(id)));

drop policy "roles: cada uno ve los suyos y el admin todos" on public.usuario_centro_rol;
create policy "roles: los propios y los de sus centros" on public.usuario_centro_rol
  for select to authenticated using (usuario_id = (select auth.uid()) or (select privado.puede_gestionar(usuario_id)));

-- ---------------------------------------------------------------- fichajes
create table public.fichajes (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null default auth.uid() references public.usuarios (id) on delete restrict,
  tipo        text not null check (tipo in ('entrada', 'pausa', 'reanudar', 'salida')),
  momento     timestamptz not null default now(),
  origen      text not null default 'app' check (origen in ('app', 'camion', 'correccion')),
  nota        text,
  creado_por  uuid not null default auth.uid() references public.usuarios (id) on delete restrict,
  creado      timestamptz not null default now(),
  odoo_estado text not null default 'pendiente'
              check (odoo_estado in ('pendiente', 'enviado', 'simulado', 'error', 'sin_empleado')),
  odoo_error  text,
  constraint correccion_con_nota check (origen <> 'correccion' or coalesce(btrim(nota), '') <> '')
);
create index fichajes_usuario_momento_idx on public.fichajes (usuario_id, momento);
create index fichajes_creado_por_idx on public.fichajes (creado_por);
alter table public.fichajes enable row level security;
revoke all on public.fichajes from anon, authenticated;
grant select, insert on public.fichajes to authenticated;
grant update (odoo_estado, odoo_error) on public.fichajes to authenticated;

create policy "fichajes: los propios y los del equipo" on public.fichajes for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puede_gestionar(usuario_id)));
create policy "fichajes: fichar uno mismo, en el momento" on public.fichajes for insert to authenticated
  with check (
    usuario_id = (select auth.uid()) and creado_por = (select auth.uid()) and origen in ('app', 'camion')
    and momento between now() - interval '2 minutes' and now() + interval '1 minute'
    and odoo_estado = 'pendiente'
    and ((select privado.tiene_modulo('fichaje')) or (select privado.tiene_modulo('chofer')))
  );
create policy "fichajes: correcciones del responsable" on public.fichajes for insert to authenticated
  with check (
    origen = 'correccion' and creado_por = (select auth.uid()) and usuario_id <> (select auth.uid())
    and (select privado.puede_gestionar(usuario_id)) and odoo_estado = 'pendiente'
  );
create policy "fichajes: estado de envío a Odoo" on public.fichajes for update to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puede_gestionar(usuario_id)))
  with check (usuario_id = (select auth.uid()) or (select privado.puede_gestionar(usuario_id)));

-- ---------------------------------------------------------------- ausencias
create table public.ausencias (
  id           bigint generated always as identity primary key,
  usuario_id   uuid not null default auth.uid() references public.usuarios (id) on delete restrict,
  tipo         text not null check (tipo in ('vacaciones', 'asuntos_propios', 'medico', 'otro')),
  desde        date not null,
  hasta        date not null,
  motivo       text,
  estado       text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'anulada')),
  resuelto_por uuid references public.usuarios (id) on delete restrict,
  resuelto_en  timestamptz,
  comentario   text,
  creado       timestamptz not null default now(),
  odoo_estado  text not null default 'pendiente'
               check (odoo_estado in ('pendiente', 'enviado', 'simulado', 'error', 'sin_empleado', 'no_aplica')),
  odoo_error   text,
  constraint fechas_en_orden check (hasta >= desde)
);
create index ausencias_usuario_idx on public.ausencias (usuario_id, desde);
create index ausencias_resuelto_por_idx on public.ausencias (resuelto_por);
alter table public.ausencias enable row level security;
revoke all on public.ausencias from anon, authenticated;
grant select, insert on public.ausencias to authenticated;
grant update (estado, resuelto_por, resuelto_en, comentario, odoo_estado, odoo_error) on public.ausencias to authenticated;

create policy "ausencias: las propias y las del equipo" on public.ausencias for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puede_gestionar(usuario_id)));
create policy "ausencias: pedir para uno mismo" on public.ausencias for insert to authenticated
  with check (
    usuario_id = (select auth.uid()) and estado = 'pendiente' and resuelto_por is null and odoo_estado = 'pendiente'
    and (select privado.tiene_modulo('ausencias'))
  );
-- Una sola política de cambio: el interesado solo puede anular la suya mientras está pendiente;
-- un responsable (o admin) resuelve las de su equipo, nunca las suyas.
create policy "ausencias: anular la propia o resolver las del equipo" on public.ausencias for update to authenticated
  using (
    (usuario_id = (select auth.uid()) and estado = 'pendiente')
    or (usuario_id <> (select auth.uid()) and (select privado.puede_gestionar(usuario_id)))
  )
  with check (
    (usuario_id = (select auth.uid()) and estado in ('pendiente', 'anulada') and resuelto_por is null)
    or (usuario_id <> (select auth.uid()) and (select privado.puede_gestionar(usuario_id)))
  );

-- ---------------------------------------------------------------- vehículos y asignaciones (chóferes)
create table public.vehiculos (
  id            bigint generated always as identity primary key,
  matricula     text not null unique,
  modelo        text,
  centro_id     bigint references public.centros (id) on delete set null,
  id_movildata  text,
  activo        boolean not null default true
);
create index vehiculos_centro_idx on public.vehiculos (centro_id);
alter table public.vehiculos enable row level security;
revoke all on public.vehiculos from anon, authenticated;
grant select, insert, update, delete on public.vehiculos to authenticated;
create policy "vehiculos: los ve cualquier usuario" on public.vehiculos for select to authenticated using (true);
create policy "vehiculos: alta solo admin" on public.vehiculos for insert to authenticated with check ((select privado.es_admin()));
create policy "vehiculos: cambio solo admin" on public.vehiculos for update to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));
create policy "vehiculos: baja solo admin" on public.vehiculos for delete to authenticated using ((select privado.es_admin()));

create table public.asignaciones (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null default auth.uid() references public.usuarios (id) on delete restrict,
  vehiculo_id bigint not null references public.vehiculos (id) on delete restrict,
  inicio      timestamptz not null default now(),
  fin         timestamptz,
  origen      text not null default 'tacografo' check (origen in ('tacografo', 'manual', 'correccion')),
  constraint fin_despues_de_inicio check (fin is null or fin > inicio)
);
-- Un chófer solo puede tener un camión abierto a la vez.
create unique index asignaciones_una_abierta on public.asignaciones (usuario_id) where fin is null;
create index asignaciones_vehiculo_idx on public.asignaciones (vehiculo_id, inicio);
alter table public.asignaciones enable row level security;
revoke all on public.asignaciones from anon, authenticated;
grant select, insert on public.asignaciones to authenticated;
grant update (fin) on public.asignaciones to authenticated;

create policy "asignaciones: las propias y las del equipo" on public.asignaciones for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puede_gestionar(usuario_id)));
create policy "asignaciones: abrir la propia o corregir las del equipo" on public.asignaciones for insert to authenticated
  with check (
    (usuario_id = (select auth.uid()) and origen in ('tacografo', 'manual') and fin is null
      and inicio between now() - interval '2 minutes' and now() + interval '1 minute'
      and (select privado.tiene_modulo('chofer')))
    or (origen = 'correccion' and usuario_id <> (select auth.uid()) and (select privado.puede_gestionar(usuario_id)))
  );
create policy "asignaciones: cerrar la propia o las del equipo" on public.asignaciones for update to authenticated
  using ((usuario_id = (select auth.uid()) and fin is null) or (select privado.puede_gestionar(usuario_id)))
  with check (
    (usuario_id = (select auth.uid()) and fin is not null and fin <= now() + interval '1 minute')
    or (select privado.puede_gestionar(usuario_id))
  );
