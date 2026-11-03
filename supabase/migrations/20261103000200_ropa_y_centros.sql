-- Ropa de trabajo y EPIs: chóferes y operarios la piden desde el móvil; el responsable de su centro la aprueba y la
-- entrega. Además, los centros reales de la empresa y los complementos Responsable y Seguridad (mapa de la empresa).

-- ---------------------------------------------------------------- centros
insert into public.centros (nombre) values
  ('Oficina Grao de Castellón'), ('Oficina Castellón de la Plana'), ('Oficina Burriana'), ('Oficina Sevilla'),
  ('Montaje Castellón'), ('Montaje Burriana'), ('Montaje Sevilla')
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------- solicitudes de ropa
create table public.solicitudes_ropa (
  id            bigint generated always as identity primary key,
  usuario_id    uuid not null default auth.uid() references public.usuarios (id) on delete restrict,
  creado        timestamptz not null default now(),
  -- [{"prenda": "botas", "talla": "42", "cantidad": 1}, …]; catálogo de prendas y tallas en src/lib/ropa.ts
  prendas       jsonb not null check (jsonb_typeof(prendas) = 'array' and jsonb_array_length(prendas) between 1 and 20),
  motivo        text not null check (motivo in ('primera_entrega', 'desgaste', 'talla', 'perdida', 'otro')),
  nota          text check (char_length(nota) <= 500),
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'entregada', 'rechazada', 'anulada')),
  resuelto_por  uuid references public.usuarios (id) on delete restrict,
  resuelto_en   timestamptz,
  comentario    text check (char_length(comentario) <= 300),
  entregado_por uuid references public.usuarios (id) on delete restrict,
  entregado_en  timestamptz,
  constraint entrega_completa check ((estado = 'entregada') = (entregado_en is not null))
);
create index solicitudes_ropa_usuario_idx on public.solicitudes_ropa (usuario_id, creado desc);
create index solicitudes_ropa_estado_idx on public.solicitudes_ropa (estado, creado desc);
create index solicitudes_ropa_resuelto_por_idx on public.solicitudes_ropa (resuelto_por);
create index solicitudes_ropa_entregado_por_idx on public.solicitudes_ropa (entregado_por);

-- De quién es y lo que pide no lo cambia nadie más que quien la pidió, y solo mientras está pendiente.
create or replace function privado.ropa_campos_fijos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.usuario_id <> old.usuario_id or new.creado <> old.creado then
    raise exception 'No se puede cambiar de quién es la solicitud';
  end if;
  if (new.prendas <> old.prendas or new.motivo <> old.motivo or new.nota is distinct from old.nota)
     and (old.estado <> 'pendiente' or old.usuario_id is distinct from (select auth.uid())) then
    raise exception 'Lo que se pide solo lo cambia quien lo pidió, mientras está pendiente';
  end if;
  return new;
end;
$$;
revoke all on function privado.ropa_campos_fijos() from public, anon, authenticated;
create trigger solicitudes_ropa_campos_fijos before update on public.solicitudes_ropa
  for each row execute function privado.ropa_campos_fijos();

alter table public.solicitudes_ropa enable row level security;
revoke all on public.solicitudes_ropa from anon;
grant select, insert, update on public.solicitudes_ropa to authenticated;   -- no se borran: queda el historial

create policy "ropa: las propias y las de su equipo" on public.solicitudes_ropa for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.puedo_sobre('ropa.gestionar', usuario_id)));
create policy "ropa: pedir para uno mismo" on public.solicitudes_ropa for insert to authenticated
  with check (usuario_id = (select auth.uid()) and estado = 'pendiente' and resuelto_por is null and resuelto_en is null
              and comentario is null and entregado_por is null and entregado_en is null
              and (select privado.tengo_permiso('ropa.pedir')));
-- Quien la pidió solo puede anularla mientras está pendiente. El responsable de su centro (nunca la suya) la aprueba o
-- rechaza y, una vez aprobada, la marca como entregada.
create policy "ropa: anular la propia o resolver las del equipo" on public.solicitudes_ropa for update to authenticated
  using ((usuario_id = (select auth.uid()) and estado = 'pendiente')
         or (usuario_id <> (select auth.uid()) and estado in ('pendiente', 'aprobada')
             and (select privado.puedo_sobre('ropa.gestionar', usuario_id))))
  with check ((usuario_id = (select auth.uid()) and estado in ('pendiente', 'anulada') and resuelto_por is null and entregado_por is null)
              or (usuario_id <> (select auth.uid()) and (select privado.puedo_sobre('ropa.gestionar', usuario_id))
                  and ((estado in ('aprobada', 'rechazada') and resuelto_por = (select auth.uid()) and entregado_por is null)
                       or (estado = 'entregada' and entregado_por = (select auth.uid())))));

-- Quien gestiona la ropa de alguien necesita ver su nombre.
create policy "usuarios: los ve quien gestiona su ropa" on public.usuarios for select to authenticated
  using ((select privado.puedo_sobre('ropa.gestionar', id)));

-- ---------------------------------------------------------------- perfiles: puestos y complementos
update public.perfiles set permisos = array(select distinct unnest(permisos || '{ropa.pedir}'))
 where nombre in ('Chófer', 'Operario', 'Operario de almacén');
update public.perfiles set descripcion = 'Operarios de los centros de montaje'
 where nombre = 'Operario' and descripcion = 'Operarios de almacén';
update public.perfiles set permisos = array(select distinct unnest(permisos || '{ropa.gestionar}')),
                           descripcion = 'Complemento: ve a las personas de su centro, aprueba sus vacaciones y su ropa y corrige sus fichajes'
 where nombre = 'Responsable';
insert into public.perfiles (nombre, descripcion, permisos, todos_los_centros) values
  ('Seguridad', 'Complemento: panel de Seguridad completo (caducidades, carretillas, inspecciones e incidencias)',
   '{seguridad.ver,seguridad.gestionar}', true)
on conflict (nombre) do nothing;
