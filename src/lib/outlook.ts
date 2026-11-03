import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { inicioDia, NOMBRE_AUSENCIA, ZONA } from "@/lib/jornada";
import { sumarDias } from "@/lib/seguridad";

/**
 * Calendario de Outlook (Microsoft Graph) de quien entra con Microsoft: agenda de hoy y ausencias aprobadas.
 * Al entrar, Microsoft da un token de renovación; se guarda CIFRADO (tabla microsoft_tokens, solo la clave de servidor)
 * y con él se pide un token de Graph cada vez que hace falta. Quien entra con código + PIN no tiene calendario.
 *
 * Apagado hasta que IT apruebe en Microsoft el permiso «Calendars.ReadWrite» (si se pidiera antes, a todos les saldría
 * «Se necesita la aprobación del administrador» al entrar) y estén en Vercel OUTLOOK_CALENDARIO=true, AZURE_CLIENT_ID,
 * AZURE_CLIENT_SECRET, AZURE_TENANT_ID, SECRET_KEY y SUPABASE_SECRET_KEY.
 */
export function calendarioActivo() {
  const e = process.env;
  return e.OUTLOOK_CALENDARIO === "true" && !!(e.AZURE_CLIENT_ID && e.AZURE_CLIENT_SECRET && e.AZURE_TENANT_ID && e.SECRET_KEY && e.SUPABASE_SECRET_KEY);
}

/** Lo que se pide a Microsoft al entrar, además del correo. */
export const ALCANCE_OUTLOOK = "offline_access Calendars.ReadWrite";

const clave = () => createHash("sha256").update(`outlook-tokens:${process.env.SECRET_KEY}`).digest();

function cifrar(texto: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", clave(), iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), datos].map((b) => b.toString("base64")).join(".");
}

function descifrar(guardado: string) {
  const [iv, etiqueta, datos] = guardado.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", clave(), iv);
  d.setAuthTag(etiqueta);
  return Buffer.concat([d.update(datos), d.final()]).toString("utf8");
}

/** Al volver de Microsoft (auth/callback): guarda el token de renovación de esa persona. */
export async function guardarTokenMicrosoft(usuarioId: string, renovacion: string) {
  if (!calendarioActivo()) return;
  await createAdminClient().from("microsoft_tokens")
    .upsert({ usuario_id: usuarioId, token_cifrado: cifrar(renovacion), actualizado: new Date().toISOString() });
}

/** Token de Graph de esa persona, o null si no lo hay (no ha vuelto a entrar, o Microsoft lo ha retirado). */
async function tokenGraph(usuarioId: string): Promise<string | null> {
  if (!calendarioActivo()) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("microsoft_tokens").select("token_cifrado").eq("usuario_id", usuarioId)
    .maybeSingle<{ token_cifrado: string }>();
  if (!data) return null;
  let renovacion: string;
  try { renovacion = descifrar(data.token_cifrado); } catch { return null; }
  const res = await fetch(`https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AZURE_CLIENT_ID!, client_secret: process.env.AZURE_CLIENT_SECRET!,
      grant_type: "refresh_token", refresh_token: renovacion, scope: ALCANCE_OUTLOOK,
    }),
    cache: "no-store", signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res) return null;
  const json = await res.json().catch(() => null) as { access_token?: string; refresh_token?: string; error?: string } | null;
  if (!res.ok || !json?.access_token) {
    // Retirado o caducado: se borra y la próxima vez que entre con Microsoft se guarda uno nuevo.
    if (json?.error === "invalid_grant") await admin.from("microsoft_tokens").delete().eq("usuario_id", usuarioId);
    return null;
  }
  if (json.refresh_token && json.refresh_token !== renovacion) {
    await admin.from("microsoft_tokens").update({ token_cifrado: cifrar(json.refresh_token), actualizado: new Date().toISOString() })
      .eq("usuario_id", usuarioId);
  }
  return json.access_token;
}

async function graph(token: string, ruta: string, init: { method?: string; body?: unknown } = {}) {
  return fetch(`https://graph.microsoft.com/v1.0${ruta}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: `outlook.timezone="${ZONA}"` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store", signal: AbortSignal.timeout(8000),
  }).catch(() => null);
}

export type Cita = { asunto: string; inicio: string; fin: string; todoElDia: boolean; lugar: string | null; enlace: string | null };

/** Citas de hoy (hora de Madrid) de su Outlook. null: sin conectar (tiene que volver a entrar con Microsoft). */
export async function agendaDeHoy(usuarioId: string): Promise<Cita[] | null> {
  const token = await tokenGraph(usuarioId);
  if (!token) return null;
  const desde = inicioDia().toISOString(), hasta = inicioDia(-1).toISOString();
  const res = await graph(token, `/me/calendarView?startDateTime=${desde}&endDateTime=${hasta}`
    + "&$select=subject,start,end,isAllDay,location,webLink,isCancelled&$orderby=start/dateTime&$top=30");
  if (!res?.ok) return null;
  type Evento = { subject?: string; start?: { dateTime: string }; end?: { dateTime: string }; isAllDay?: boolean;
    location?: { displayName?: string }; webLink?: string; isCancelled?: boolean };
  const { value = [] } = (await res.json().catch(() => ({}))) as { value?: Evento[] };
  return value.filter((e) => !e.isCancelled && e.start && e.end).map((e) => ({
    asunto: e.subject || "(Sin asunto)", inicio: e.start!.dateTime, fin: e.end!.dateTime, todoElDia: !!e.isAllDay,
    lugar: e.location?.displayName || null, enlace: e.webLink ?? null,
  }));
}

/** Al aprobarse una ausencia, se apunta en el Outlook de esa persona (como «fuera de la oficina»). Una sola vez. */
export async function apuntarAusenciaEnOutlook(ausenciaId: number) {
  if (!calendarioActivo()) return;
  const admin = createAdminClient();
  const [{ data: a }, { data: ya }] = await Promise.all([
    admin.from("ausencias").select("id,usuario_id,tipo,desde,hasta,estado").eq("id", ausenciaId)
      .maybeSingle<{ id: number; usuario_id: string; tipo: string; desde: string; hasta: string; estado: string }>(),
    admin.from("outlook_eventos").select("evento_id").eq("ausencia_id", ausenciaId).maybeSingle(),
  ]);
  if (!a || a.estado !== "aprobada" || ya) return;
  const token = await tokenGraph(a.usuario_id);
  if (!token) return;
  const res = await graph(token, "/me/events", {
    method: "POST",
    body: {
      subject: `${NOMBRE_AUSENCIA[a.tipo] ?? "Ausencia"} (aprobada)`,
      isAllDay: true, showAs: "oof", isReminderOn: false,
      start: { dateTime: `${a.desde}T00:00:00`, timeZone: ZONA },
      end: { dateTime: `${sumarDias(a.hasta, 1)}T00:00:00`, timeZone: ZONA },
      body: { contentType: "text", content: "Apuntado por la app de Grupo Trimodos al aprobarse la ausencia." },
    },
  });
  const evento = res?.ok ? ((await res.json().catch(() => null)) as { id?: string } | null) : null;
  if (evento?.id) await admin.from("outlook_eventos").insert({ ausencia_id: a.id, usuario_id: a.usuario_id, evento_id: evento.id });
}
