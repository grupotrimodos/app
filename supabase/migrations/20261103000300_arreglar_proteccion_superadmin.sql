-- La protección del superadministrador consultaba privado.es_admin() también cuando escribe el servidor (clave secreta),
-- que no tiene acceso al esquema privado: «permission denied for schema privado». Resultado: fallaba toda escritura del
-- servidor en usuarios (alta con código + PIN a medias, enlace automático con la ficha de empleado de Odoo).
-- Ahora el servidor y el editor SQL pasan ANTES de consultar nada; las comprobaciones para los usuarios no cambian.
create or replace function privado.proteger_superadmin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if (select privado.es_admin()) then
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
revoke all on function privado.proteger_superadmin() from public, anon, authenticated;
