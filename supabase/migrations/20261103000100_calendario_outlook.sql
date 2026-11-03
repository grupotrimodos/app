-- Calendario de Outlook (Microsoft Graph) de quien entra con Microsoft: agenda de hoy en el inicio y ausencias
-- aprobadas apuntadas en su calendario. Solo el servidor (clave secreta) lee y escribe estas tablas: ningún usuario,
-- ni siquiera el propio, puede leer su token desde el navegador.

-- Token de renovación de Microsoft de cada persona, CIFRADO en el servidor (src/lib/outlook.ts) antes de guardarlo.
create table public.microsoft_tokens (
  usuario_id    uuid primary key references public.usuarios (id) on delete cascade,
  token_cifrado text not null,
  actualizado   timestamptz not null default now()
);

-- Qué ausencia está ya en qué evento de Outlook (para no duplicarla y para quitarla si se anula).
create table public.outlook_eventos (
  ausencia_id bigint primary key references public.ausencias (id) on delete cascade,
  usuario_id  uuid not null references public.usuarios (id) on delete cascade,
  evento_id   text not null,
  creado      timestamptz not null default now()
);
create index outlook_eventos_usuario_idx on public.outlook_eventos (usuario_id);

alter table public.microsoft_tokens enable row level security;
alter table public.outlook_eventos  enable row level security;
revoke all on public.microsoft_tokens, public.outlook_eventos from anon, authenticated;
-- Sin políticas a propósito: con RLS activado y sin permisos, solo la clave de servidor llega a ellas.
