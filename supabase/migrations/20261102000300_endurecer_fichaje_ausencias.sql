-- Endurecimiento tras revisión:
-- 1. Un fichaje o ausencia ya enviado a Odoo (o simulado) no puede volver a «pendiente»: evitaría duplicados en Odoo.
-- 2. Un responsable solo resuelve ausencias PENDIENTES y queda él como quien resuelve.
-- 3. Las correcciones de fichaje no pueden tener hora futura.
-- 4. Un responsable no puede cambiar sus propias asignaciones de camión por la vía de responsable.

create or replace function privado.bloquear_envio_odoo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.odoo_estado in ('enviado', 'simulado') and new.odoo_estado is distinct from old.odoo_estado then
    raise exception 'Este registro ya se envió a Odoo y no se puede volver a enviar';
  end if;
  return new;
end;
$$;
revoke all on function privado.bloquear_envio_odoo() from public, anon, authenticated;

create trigger fichajes_no_reenviar before update on public.fichajes
  for each row execute function privado.bloquear_envio_odoo();
create trigger ausencias_no_reenviar before update on public.ausencias
  for each row execute function privado.bloquear_envio_odoo();

-- Una ausencia resuelta (aprobada, rechazada o anulada) ya no cambia de estado.
create or replace function privado.ausencia_resuelta_fija()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado <> 'pendiente' and new.estado is distinct from old.estado then
    raise exception 'Esta ausencia ya está resuelta';
  end if;
  return new;
end;
$$;
revoke all on function privado.ausencia_resuelta_fija() from public, anon, authenticated;
create trigger ausencias_resuelta_fija before update on public.ausencias
  for each row execute function privado.ausencia_resuelta_fija();

drop policy "ausencias: anular la propia o resolver las del equipo" on public.ausencias;
create policy "ausencias: anular la propia o resolver las del equipo" on public.ausencias for update to authenticated
  using (
    (usuario_id = (select auth.uid()) and estado = 'pendiente')
    or (usuario_id <> (select auth.uid()) and (select privado.puede_gestionar(usuario_id))
        and (estado = 'pendiente' or (estado = 'aprobada' and resuelto_por = (select auth.uid()))))
  )
  with check (
    (usuario_id = (select auth.uid()) and estado in ('pendiente', 'anulada') and resuelto_por is null)
    or (usuario_id <> (select auth.uid()) and (select privado.puede_gestionar(usuario_id))
        and estado in ('aprobada', 'rechazada') and resuelto_por = (select auth.uid()))
  );

drop policy "fichajes: correcciones del responsable" on public.fichajes;
create policy "fichajes: correcciones del responsable" on public.fichajes for insert to authenticated
  with check (
    origen = 'correccion' and creado_por = (select auth.uid()) and usuario_id <> (select auth.uid())
    and momento <= now() and (select privado.puede_gestionar(usuario_id)) and odoo_estado = 'pendiente'
  );

drop policy "asignaciones: cerrar la propia o las del equipo" on public.asignaciones;
create policy "asignaciones: cerrar la propia o las del equipo" on public.asignaciones for update to authenticated
  using (
    (usuario_id = (select auth.uid()) and fin is null)
    or (usuario_id <> (select auth.uid()) and (select privado.puede_gestionar(usuario_id)))
  )
  with check (
    (usuario_id = (select auth.uid()) and fin is not null and fin <= now() + interval '1 minute')
    or (usuario_id <> (select auth.uid()) and (select privado.puede_gestionar(usuario_id)))
  );
