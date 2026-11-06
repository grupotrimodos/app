-- Frenos en la base de datos contra duplicados que hoy solo evita la pantalla (y no del todo: un doble toque, dos
-- móviles o una lectura fallida los dejaban pasar, y en Odoo bloqueaban los envíos siguientes de esa persona).

-- ---------------------------------------------------------------- fichajes en orden
-- Cada fichaje propio (no las correcciones del responsable, que van con hora pasada) tiene que seguir al anterior como
-- en la pantalla (src/lib/jornada.ts, SIGUIENTES): entrada si no hay nada o lo último es una salida; pausa o salida si
-- se está trabajando; vuelta o salida si se está en pausa. «Lo anterior» es lo fichado desde el comienzo de ayer (hora
-- de Madrid), la misma ventana que usa la app. Un bloqueo por persona evita que dos fichajes a la vez se cuelen.
create or replace function privado.fichaje_en_orden()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  previo text;
begin
  if new.origen = 'correccion' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fichajes:' || new.usuario_id::text, 0));
  select f.tipo into previo
    from public.fichajes f
   where f.usuario_id = new.usuario_id
     and f.momento >= (((now() at time zone 'Europe/Madrid')::date - 1)::timestamp at time zone 'Europe/Madrid')
   order by f.momento desc, f.id desc
   limit 1;
  if not ((coalesce(previo, 'salida') = 'salida' and new.tipo = 'entrada')
          or (previo in ('entrada', 'reanudar') and new.tipo in ('pausa', 'salida'))
          or (previo = 'pausa' and new.tipo in ('reanudar', 'salida'))) then
    raise exception 'Ese fichaje no corresponde ahora (lo último es «%»)', coalesce(previo, 'nada')
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function privado.fichaje_en_orden() from public, anon, authenticated;
create trigger fichajes_en_orden before insert on public.fichajes
  for each row execute function privado.fichaje_en_orden();

-- ---------------------------------------------------------------- ausencias sin solapes
-- Una persona no puede tener dos solicitudes vivas (pendiente o aprobada) que se pisen: la segunda acabaría en error
-- en Odoo para siempre. Las rechazadas y anuladas no cuentan.
create extension if not exists btree_gist with schema extensions;
alter table public.ausencias
  add constraint ausencias_sin_solape
  exclude using gist (usuario_id with =, daterange(desde, hasta, '[]') with &&)
  where (estado in ('pendiente', 'aprobada'));
