-- Sincronización automática con Odoo (servicios/sincronizacion.py).
-- 1. Los camiones guardan el id del vehículo de la flota de Odoo (se importan solos).
-- 2. Registro de cada pasada de sincronización, para la pantalla «Sincronización».
--    Solo lo escribe el servidor (clave secreta); lo ve quien tenga el permiso «admin.sincronizacion».

alter table public.vehiculos add column odoo_id bigint unique;

create table public.odoo_sincronizacion (
  id        bigint generated always as identity primary key,
  inicio    timestamptz not null default now(),
  fin       timestamptz,
  origen    text not null,                       -- «automatica» o «manual: <nombre>»
  modo      text not null default 'simulado',    -- simulado (RRHH_DRY_RUN) o real
  resultado jsonb not null default '{}'
);
create index odoo_sincronizacion_inicio_idx on public.odoo_sincronizacion (inicio desc);

alter table public.odoo_sincronizacion enable row level security;
revoke all on public.odoo_sincronizacion from anon, authenticated;
grant select on public.odoo_sincronizacion to authenticated;

create policy "odoo_sincronizacion: la ve quien gestiona la sincronización" on public.odoo_sincronizacion
  for select to authenticated using ((select privado.tengo_permiso('admin.sincronizacion')));
