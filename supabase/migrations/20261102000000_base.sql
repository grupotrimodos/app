-- Base de la app general de Grupo Trimodos: usuarios, centros, roles por centro y módulos.
-- Se ejecuta una vez en Supabase (SQL Editor → pegar → Run) o con `supabase db push`.
-- Los permisos viven en la base de datos (RLS): cada usuario solo ve su fila; los administradores ven y editan todo.

-- ---------------------------------------------------------------- tablas
create table public.centros (
  id      bigint generated always as identity primary key,
  nombre  text not null unique,
  activo  boolean not null default true,
  creado  timestamptz not null default now()
);

create table public.usuarios (
  id                  uuid primary key references auth.users (id) on delete cascade,
  nombre              text not null default '',
  email               text,                       -- cuenta de Microsoft (personal de oficina)
  codigo              text unique,                -- conductores y operarios: entran con código + PIN
  activo              boolean not null default false,  -- nadie entra hasta que un administrador lo activa
  es_admin            boolean not null default false,
  modulos             text[] not null default '{}',  -- p. ej. {deca}
  odoo_employee_id    integer,                    -- vínculo con Odoo (fichaje, etc.)
  movildata_driver_id text,                       -- vínculo con Movildata
  tarjeta_tacografo   text,
  creado              timestamptz not null default now(),
  constraint codigo_formato check (codigo is null or codigo ~ '^[A-Za-z0-9]{3,20}$')
);

create table public.usuario_centro_rol (
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  centro_id  bigint not null references public.centros (id) on delete cascade,
  rol        text not null check (rol in ('responsable', 'oficina', 'chofer', 'operario')),
  primary key (usuario_id, centro_id)
);

-- ---------------------------------------------------------------- funciones
-- ¿El usuario que hace la consulta es administrador activo? (security definer: evita recursión en las políticas)
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select u.es_admin and u.activo from public.usuarios u where u.id = (select auth.uid())), false);
$$;
revoke all on function public.es_admin() from public;
grant execute on function public.es_admin() to authenticated;

-- Cada alta en Supabase Auth (Microsoft o código + PIN) crea su fila en usuarios INACTIVA y sin módulos:
-- un administrador la activa y le asigna módulos. Así, aunque alguien consiguiera registrarse, no ve nada.
create or replace function public.crear_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.usuarios (id, email, nombre)
  values (
    new.id,
    case when new.email like '%@pin.grupotrimodos.com' then null else new.email end,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_usuario();

-- ---------------------------------------------------------------- permisos (RLS)
alter table public.centros            enable row level security;
alter table public.usuarios           enable row level security;
alter table public.usuario_centro_rol enable row level security;

revoke all on public.centros, public.usuarios, public.usuario_centro_rol from anon;
grant select, insert, update, delete on public.centros, public.usuarios, public.usuario_centro_rol to authenticated;

create policy "centros: los ve cualquier usuario"      on public.centros for select to authenticated using (true);
create policy "centros: los gestiona un administrador" on public.centros for all    to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

create policy "usuarios: cada uno ve su fila y el admin todas" on public.usuarios for select to authenticated
  using (id = (select auth.uid()) or (select public.es_admin()));
create policy "usuarios: solo el admin modifica" on public.usuarios for update to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));
create policy "usuarios: solo el admin borra" on public.usuarios for delete to authenticated
  using ((select public.es_admin()));

create policy "roles: cada uno ve los suyos y el admin todos" on public.usuario_centro_rol for select to authenticated
  using (usuario_id = (select auth.uid()) or (select public.es_admin()));
create policy "roles: los gestiona un administrador" on public.usuario_centro_rol for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

-- ---------------------------------------------------------------- primer administrador
-- Después de entrar por primera vez con tu cuenta de Microsoft, ejecuta (con tu correo):
--   update public.usuarios set activo = true, es_admin = true, modulos = '{deca}' where email = 'tu-correo@grupotrimodos.com';
