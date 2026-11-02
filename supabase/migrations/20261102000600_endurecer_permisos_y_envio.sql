-- Endurecimiento tras la revisión de perfiles y sincronización:
-- 1. Nadie desde la app marca el estado de envío a Odoo: solo el servidor (clave secreta) tras enviar de verdad.
--    Al rechazar o anular una ausencia, «no_aplica» lo pone la base de datos.
-- 2. «simulado» (modo prueba) puede volver a «pendiente», pero solo desde el servidor o el editor SQL
--    (para enviar a Odoo lo fichado en pruebas, si se decide). «enviado» sigue siendo definitivo.
-- 3. Un superadministrador no se puede borrar salvo por otro; el correo y el código de acceso solo los cambia
--    un superadministrador (con ellos se podría tomar la cuenta de otra persona).
-- 4. mis_permisos() no devuelve nada a un usuario inactivo.

-- 1 ------------------------------------------------------------------
revoke update (odoo_estado, odoo_error) on public.fichajes from authenticated;
revoke update (odoo_estado, odoo_error) on public.ausencias from authenticated;
drop policy "fichajes: estado de envío a Odoo" on public.fichajes;

create or replace function privado.ausencia_no_aplica()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.estado in ('rechazada', 'anulada') and new.estado is distinct from old.estado and new.odoo_estado = 'pendiente' then
    new.odoo_estado := 'no_aplica';
  end if;
  return new;
end;
$$;
revoke all on function privado.ausencia_no_aplica() from public, anon, authenticated;
create trigger ausencias_no_aplica before update on public.ausencias
  for each row execute function privado.ausencia_no_aplica();

-- 2 ------------------------------------------------------------------
create or replace function privado.bloquear_envio_odoo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.odoo_estado is distinct from old.odoo_estado then
    if old.odoo_estado = 'enviado' then
      raise exception 'Este registro ya se envió a Odoo y no se puede volver a enviar';
    end if;
    if old.odoo_estado = 'simulado' and current_user in ('authenticated', 'anon') then
      raise exception 'Solo el servidor puede volver a poner en cola un registro simulado';
    end if;
  end if;
  return new;
end;
$$;

-- 3 ------------------------------------------------------------------
create or replace function privado.proteger_superadmin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Solo afecta a los usuarios de la app; el editor SQL de Supabase y la clave de servidor pueden.
  if current_user not in ('authenticated', 'anon') or (select privado.es_admin()) then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.es_admin then
      raise exception 'Solo un superadministrador puede borrar a un superadministrador';
    end if;
    return old;
  end if;
  if old.es_admin or new.es_admin then
    raise exception 'Solo un superadministrador puede cambiar a un superadministrador';
  end if;
  if new.email is distinct from old.email or new.codigo is distinct from old.codigo then
    raise exception 'Solo un superadministrador puede cambiar el correo o el código de acceso';
  end if;
  return new;
end;
$$;
drop trigger usuarios_proteger_superadmin on public.usuarios;
create trigger usuarios_proteger_superadmin before update or delete on public.usuarios
  for each row execute function privado.proteger_superadmin();

-- 4 ------------------------------------------------------------------
create or replace function public.mis_permisos()
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(distinct p order by p), '{}')
  from public.usuario_perfil up
  join public.usuarios u on u.id = up.usuario_id and u.activo
  join public.perfiles pf on pf.id = up.perfil_id
  cross join lateral unnest(pf.permisos) as p
  where up.usuario_id = (select auth.uid());
$$;
