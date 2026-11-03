import type { createClient } from "@/lib/supabase/server";
import { DOCUMENTOS_PERSONA, DOCUMENTOS_VEHICULO, leerFecha, SIN_CADUCIDAD, situacionDocumentos, type Documento } from "@/lib/seguridad";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Guarda (o actualiza) un documento de una persona o de un vehículo a partir de un formulario con `tipo`, `caduca` y
 * `numero`. Devuelve el error para la pantalla o null. Quién puede hacerlo lo decide la base de datos (RLS).
 */
export async function guardarDocumento(supabase: Supabase, de: { usuario_id: string } | { vehiculo_id: number }, form: FormData) {
  const tipo = String(form.get("tipo") ?? "");
  const catalogo = "usuario_id" in de ? DOCUMENTOS_PERSONA : DOCUMENTOS_VEHICULO;
  if (!(tipo in catalogo)) return "Ese documento no existe.";
  const texto = String(form.get("caduca") ?? "").trim();
  const caduca = leerFecha(texto);
  if (texto && !caduca) return "Revisa la fecha.";
  if (!caduca && !SIN_CADUCIDAD.has(tipo)) return `Pon la fecha de caducidad de «${catalogo[tipo]}».`;
  const numero = String(form.get("numero") ?? "").trim().slice(0, 60) || null;
  const filtro = "usuario_id" in de ? { usuario_id: de.usuario_id, tipo } : { vehiculo_id: de.vehiculo_id, tipo };
  const { data: ya } = await supabase.from("documentos").select("id").match(filtro).maybeSingle<{ id: number }>();
  const { error } = ya
    ? await supabase.from("documentos").update({ caduca, numero }).eq("id", ya.id)
    : await supabase.from("documentos").insert({ ...filtro, caduca, numero });
  return error ? "No se ha podido guardar el documento." : null;
}

/** Documentación que pide el puesto de una persona (la suma de sus perfiles) y cómo la tiene. Con los permisos de
 *  quien consulta: uno mismo ve la suya; seguridad, la de todos. */
export async function documentosDe(supabase: Supabase, usuarioId: string) {
  const [{ data: perfiles }, { data: docs }] = await Promise.all([
    supabase.from("usuario_perfil").select("perfiles(documentos)").eq("usuario_id", usuarioId),
    supabase.from("documentos").select("id,usuario_id,vehiculo_id,tipo,numero,caduca").eq("usuario_id", usuarioId),
  ]);
  type Fila = { perfiles: { documentos: string[] } | null };
  const obligatorios = [...new Set(((perfiles ?? []) as unknown as Fila[]).flatMap((f) => f.perfiles?.documentos ?? []))];
  const documentos = (docs ?? []) as Documento[];
  return { obligatorios, documentos, situacion: situacionDocumentos(obligatorios, documentos) };
}
