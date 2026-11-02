-- Ajustes tras los avisos de seguridad y rendimiento de Supabase:
-- 1. es_admin() pasa a un esquema privado (no se puede llamar desde la API) y crear_usuario() deja de ser ejecutable.
-- 2. Las políticas de administrador ya no se solapan con las de lectura.
-- 3. Índice para la clave ajena de centro.

create schema if not exists privado;
revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated;

create or replace function privado.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select u.es_admin and u.activo from public.usuarios u where u.id = (select auth.uid())), false);
$$;
revoke all on function privado.es_admin() from public, anon;
grant execute on function privado.es_admin() to authenticated;

revoke all on function public.crear_usuario() from public, anon, authenticated;

-- centros
drop policy "centros: los gestiona un administrador" on public.centros;
create policy "centros: alta solo admin"   on public.centros for insert to authenticated with check ((select privado.es_admin()));
create policy "centros: cambio solo admin" on public.centros for update to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));
create policy "centros: baja solo admin"   on public.centros for delete to authenticated using ((select privado.es_admin()));

-- usuarios
drop policy "usuarios: cada uno ve su fila y el admin todas" on public.usuarios;
drop policy "usuarios: solo el admin modifica" on public.usuarios;
drop policy "usuarios: solo el admin borra" on public.usuarios;
create policy "usuarios: cada uno ve su fila y el admin todas" on public.usuarios for select to authenticated
  using (id = (select auth.uid()) or (select privado.es_admin()));
create policy "usuarios: solo el admin modifica" on public.usuarios for update to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));
create policy "usuarios: solo el admin borra" on public.usuarios for delete to authenticated
  using ((select privado.es_admin()));

-- roles por centro
drop policy "roles: cada uno ve los suyos y el admin todos" on public.usuario_centro_rol;
drop policy "roles: los gestiona un administrador" on public.usuario_centro_rol;
create policy "roles: cada uno ve los suyos y el admin todos" on public.usuario_centro_rol for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.es_admin()));
create policy "roles: alta solo admin"   on public.usuario_centro_rol for insert to authenticated with check ((select privado.es_admin()));
create policy "roles: cambio solo admin" on public.usuario_centro_rol for update to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));
create policy "roles: baja solo admin"   on public.usuario_centro_rol for delete to authenticated using ((select privado.es_admin()));

drop function public.es_admin();

create index if not exists usuario_centro_rol_centro_id_idx on public.usuario_centro_rol (centro_id);
