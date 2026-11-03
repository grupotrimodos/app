-- Seguridad: documentación con caducidad (personas y vehículos), carretillas y traspaletas con sus revisiones,
-- inspecciones de almacén e incidencias. Permisos (src/lib/permisos.json): seguridad.ver, seguridad.gestionar,
-- documentos.propios (cada uno mantiene la suya) e incidencias.reportar.
-- Qué documentación pide cada puesto lo decide el administrador en el perfil (perfiles.documentos).

-- ---------------------------------------------------------------- documentación obligatoria de cada perfil
alter table public.perfiles add column documentos text[] not null default '{}';

-- ---------------------------------------------------------------- documentos (de una persona o de un vehículo)
create table public.documentos (
  id              bigint generated always as identity primary key,
  usuario_id      uuid references public.usuarios (id) on delete cascade,
  vehiculo_id     bigint references public.vehiculos (id) on delete cascade,
  tipo            text not null check (tipo ~ '^[a-z_]{2,40}$'),   -- catálogo en src/lib/seguridad.ts
  numero          text check (char_length(numero) <= 60),
  caduca          date,
  nota            text check (char_length(nota) <= 300),
  actualizado     timestamptz not null default now(),
  actualizado_por uuid references public.usuarios (id) on delete set null,
  constraint documento_de_alguien check ((usuario_id is null) <> (vehiculo_id is null)),
  constraint documento_unico unique nulls not distinct (usuario_id, vehiculo_id, tipo)
);
create index documentos_usuario_idx on public.documentos (usuario_id);
create index documentos_vehiculo_idx on public.documentos (vehiculo_id);
create index documentos_actualizado_por_idx on public.documentos (actualizado_por);
create index documentos_caduca_idx on public.documentos (caduca);

-- Quién y cuándo lo cambió lo pone la base de datos, no quien escribe.
create or replace function privado.documento_firmado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado := now();
  new.actualizado_por := (select auth.uid());
  return new;
end;
$$;
revoke all on function privado.documento_firmado() from public, anon, authenticated;
create trigger documentos_firmado before insert or update on public.documentos
  for each row execute function privado.documento_firmado();

-- ---------------------------------------------------------------- carretillas, traspaletas y sus revisiones
create table public.equipos (
  id               bigint generated always as identity primary key,
  tipo             text not null check (tipo in ('carretilla', 'traspaleta', 'apilador', 'otro')),
  nombre           text not null check (char_length(nombre) between 1 and 60),   -- número o código interno
  marca_modelo     text check (char_length(marca_modelo) <= 80),
  centro_id        bigint references public.centros (id) on delete set null,
  proxima_revision date,
  activo           boolean not null default true,
  creado           timestamptz not null default now(),
  constraint equipo_unico unique (tipo, nombre)
);
create index equipos_centro_idx on public.equipos (centro_id);

create table public.equipo_revisiones (
  id         bigint generated always as identity primary key,
  equipo_id  bigint not null references public.equipos (id) on delete cascade,
  fecha      date not null default current_date,
  tipo       text not null check (tipo in ('revision', 'mantenimiento', 'averia', 'reparacion')),
  resultado  text not null check (resultado in ('correcto', 'con_defectos', 'fuera_de_servicio')),
  nota       text check (char_length(nota) <= 500),
  creado_por uuid not null default auth.uid() references public.usuarios (id) on delete restrict,
  creado     timestamptz not null default now()
);
create index equipo_revisiones_equipo_idx on public.equipo_revisiones (equipo_id, fecha desc);
create index equipo_revisiones_creado_por_idx on public.equipo_revisiones (creado_por);

-- ---------------------------------------------------------------- inspecciones de seguridad de almacén
create table public.inspecciones (
  id            bigint generated always as identity primary key,
  centro_id     bigint references public.centros (id) on delete set null,
  lugar         text check (char_length(lugar) <= 80),
  fecha         date not null default current_date,
  resultado     text not null check (resultado in ('correcta', 'con_deficiencias')),
  deficiencias  text check (char_length(deficiencias) <= 1000),
  proxima       date,
  realizada_por uuid not null default auth.uid() references public.usuarios (id) on delete restrict,
  creado        timestamptz not null default now(),
  constraint inspeccion_con_sitio check (centro_id is not null or lugar is not null)
);
create index inspecciones_centro_idx on public.inspecciones (centro_id, fecha desc);
create index inspecciones_realizada_por_idx on public.inspecciones (realizada_por);

-- ---------------------------------------------------------------- incidencias
create table public.incidencias (
  id            bigint generated always as identity primary key,
  reportado_por uuid not null default auth.uid() references public.usuarios (id) on delete restrict,
  creado        timestamptz not null default now(),
  ocurrio       timestamptz not null default now(),
  tipo          text not null check (tipo in ('accidente', 'incidente', 'averia', 'otro')),
  gravedad      text not null default 'leve' check (gravedad in ('leve', 'grave', 'muy_grave')),
  lugar         text check (char_length(lugar) <= 120),
  vehiculo_id   bigint references public.vehiculos (id) on delete set null,
  equipo_id     bigint references public.equipos (id) on delete set null,
  descripcion   text not null check (char_length(descripcion) between 3 and 2000),
  estado        text not null default 'abierta' check (estado in ('abierta', 'en_curso', 'cerrada')),
  medidas       text check (char_length(medidas) <= 2000),
  cerrada_por   uuid references public.usuarios (id) on delete restrict,
  cerrada_en    timestamptz,
  constraint cierre_completo check ((estado = 'cerrada') = (cerrada_en is not null))
);
create index incidencias_estado_idx on public.incidencias (estado, creado desc);
create index incidencias_reportado_por_idx on public.incidencias (reportado_por);
create index incidencias_vehiculo_idx on public.incidencias (vehiculo_id);
create index incidencias_equipo_idx on public.incidencias (equipo_id);
create index incidencias_cerrada_por_idx on public.incidencias (cerrada_por);

-- ---------------------------------------------------------------- permisos (RLS)
alter table public.documentos        enable row level security;
alter table public.equipos           enable row level security;
alter table public.equipo_revisiones enable row level security;
alter table public.inspecciones      enable row level security;
alter table public.incidencias       enable row level security;
revoke all on public.documentos, public.equipos, public.equipo_revisiones, public.inspecciones, public.incidencias from anon;
grant select, insert, update, delete on public.documentos, public.equipos, public.inspecciones, public.incidencias to authenticated;
grant select, insert on public.equipo_revisiones to authenticated;   -- las revisiones son un registro: no se cambian

-- Documentos: los propios (con «documentos.propios»), los de todos para seguridad, y los de vehículos también para
-- quien gestiona camiones.
create policy "documentos: los propios, seguridad y camiones" on public.documentos for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.tengo_permiso('seguridad.ver'))
         or (select privado.tengo_permiso('seguridad.gestionar'))
         or (vehiculo_id is not null and (select privado.tengo_permiso('vehiculos.gestionar'))));
create policy "documentos: alta" on public.documentos for insert to authenticated
  with check ((usuario_id = (select auth.uid()) and (select privado.tengo_permiso('documentos.propios')))
              or (select privado.tengo_permiso('seguridad.gestionar'))
              or (vehiculo_id is not null and (select privado.tengo_permiso('vehiculos.gestionar'))));
create policy "documentos: cambio" on public.documentos for update to authenticated
  using ((usuario_id = (select auth.uid()) and (select privado.tengo_permiso('documentos.propios')))
         or (select privado.tengo_permiso('seguridad.gestionar'))
         or (vehiculo_id is not null and (select privado.tengo_permiso('vehiculos.gestionar'))))
  with check ((usuario_id = (select auth.uid()) and (select privado.tengo_permiso('documentos.propios')))
              or (select privado.tengo_permiso('seguridad.gestionar'))
              or (vehiculo_id is not null and (select privado.tengo_permiso('vehiculos.gestionar'))));
create policy "documentos: baja" on public.documentos for delete to authenticated
  using ((select privado.tengo_permiso('seguridad.gestionar'))
         or (vehiculo_id is not null and (select privado.tengo_permiso('vehiculos.gestionar'))));

create policy "equipos: los ve seguridad" on public.equipos for select to authenticated
  using ((select privado.tengo_permiso('seguridad.ver')) or (select privado.tengo_permiso('seguridad.gestionar')));
create policy "equipos: alta" on public.equipos for insert to authenticated
  with check ((select privado.tengo_permiso('seguridad.gestionar')));
create policy "equipos: cambio" on public.equipos for update to authenticated
  using ((select privado.tengo_permiso('seguridad.gestionar'))) with check ((select privado.tengo_permiso('seguridad.gestionar')));
create policy "equipos: baja" on public.equipos for delete to authenticated
  using ((select privado.tengo_permiso('seguridad.gestionar')));

create policy "equipo_revisiones: las ve seguridad" on public.equipo_revisiones for select to authenticated
  using ((select privado.tengo_permiso('seguridad.ver')) or (select privado.tengo_permiso('seguridad.gestionar')));
create policy "equipo_revisiones: anotar" on public.equipo_revisiones for insert to authenticated
  with check (creado_por = (select auth.uid()) and (select privado.tengo_permiso('seguridad.gestionar')));

create policy "inspecciones: las ve seguridad" on public.inspecciones for select to authenticated
  using ((select privado.tengo_permiso('seguridad.ver')) or (select privado.tengo_permiso('seguridad.gestionar')));
create policy "inspecciones: anotar" on public.inspecciones for insert to authenticated
  with check (realizada_por = (select auth.uid()) and (select privado.tengo_permiso('seguridad.gestionar')));
create policy "inspecciones: cambio" on public.inspecciones for update to authenticated
  using ((select privado.tengo_permiso('seguridad.gestionar'))) with check ((select privado.tengo_permiso('seguridad.gestionar')));
create policy "inspecciones: baja" on public.inspecciones for delete to authenticated
  using ((select privado.tengo_permiso('seguridad.gestionar')));

-- Incidencias: quien reporta ve las suyas; seguridad las ve todas y es la única que las cambia y las cierra.
create policy "incidencias: las propias y seguridad" on public.incidencias for select to authenticated
  using (reportado_por = (select auth.uid()) or (select privado.tengo_permiso('seguridad.ver'))
         or (select privado.tengo_permiso('seguridad.gestionar')));
create policy "incidencias: reportar" on public.incidencias for insert to authenticated
  with check (reportado_por = (select auth.uid()) and estado = 'abierta' and medidas is null
              and cerrada_por is null and cerrada_en is null and ocurrio <= now() + interval '5 minutes'
              and (select privado.tengo_permiso('incidencias.reportar')));
create policy "incidencias: seguimiento" on public.incidencias for update to authenticated
  using ((select privado.tengo_permiso('seguridad.gestionar'))) with check ((select privado.tengo_permiso('seguridad.gestionar')));

-- Seguridad necesita ver a las personas y sus perfiles para saber qué documentación les falta.
create policy "usuarios: los ve seguridad" on public.usuarios for select to authenticated
  using ((select privado.tengo_permiso('seguridad.ver')) or (select privado.tengo_permiso('seguridad.gestionar')));
create policy "usuario_perfil: los ve seguridad" on public.usuario_perfil for select to authenticated
  using ((select privado.tengo_permiso('seguridad.ver')) or (select privado.tengo_permiso('seguridad.gestionar')));

-- ---------------------------------------------------------------- configuración inicial de los perfiles de serie
update public.perfiles set permisos = array(select distinct unnest(permisos || '{documentos.propios,incidencias.reportar}')),
                           documentos = '{carnet_conducir,cap,tarjeta_tacografo,reconocimiento_medico}'
 where nombre = 'Chófer';
update public.perfiles set permisos = array(select distinct unnest(permisos || '{documentos.propios,incidencias.reportar}')),
                           documentos = '{formacion_carretillas,reconocimiento_medico}'
 where nombre = 'Operario de almacén' or nombre = 'Operario';
update public.perfiles set permisos = array(select distinct unnest(permisos || '{incidencias.reportar}'))
 where nombre = 'Oficina';
