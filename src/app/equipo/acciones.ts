"use server";
import { revalidatePath } from "next/cache";
import { conPermiso } from "@/lib/usuario";
import { madridAInstante } from "@/lib/jornada";
import { apuntarAusenciaEnOutlook } from "@/lib/outlook";
import { resultadoEnvio, type EnvioFichajes } from "@/lib/envioOdoo";
import { llamarPython } from "@/lib/python";
import { volverA } from "@/lib/volver";

/** Vuelve a «Mi equipo» con el mismo centro elegido, y el mensaje. */
const volver = (msg: string, tipo: "ok" | "error" = "ok") => volverA("/equipo", msg, tipo);


// Cada acción exige su permiso; además, la base de datos solo deja actuar sobre personas de los centros propios.
export async function resolverAusencia(form: FormData) {
  const { supabase, uid } = await conPermiso("ausencias.aprobar");
  const id = Number(form.get("id"));
  const decision = form.get("decision");
  if (decision !== "aprobar" && decision !== "rechazar") return volver("Pulsa «Aprobar» o «Rechazar».", "error");
  const aprobar = decision === "aprobar";
  const comentario = String(form.get("comentario") ?? "").trim().slice(0, 300) || null;
  // Los permisos de la base de datos impiden resolver las propias o las de fuera de tus centros.
  // Al rechazar, la base de datos marca sola que no va a Odoo (el estado de envío solo lo cambia el servidor).
  const { data, error } = await supabase.from("ausencias")
    .update({ estado: aprobar ? "aprobada" : "rechazada", resuelto_por: uid, resuelto_en: new Date().toISOString(), comentario })
    .eq("id", id).eq("estado", "pendiente").select("id");
  if (error || !data?.length) return volver("No se ha podido resolver (puede que ya esté resuelta o no sea de tu equipo).", "error");
  let odoo = "";
  if (aprobar) {
    const r = await llamarPython<{ estado: string; detalle?: string }>(`/api/rrhh/ausencias/${id}/sincronizar`, { method: "POST" });
    await apuntarAusenciaEnOutlook(id).catch(() => {});   // en su calendario, si está conectado
    // Quien aprueba sabe si ya está en Odoo (si no, la sincronización automática lo reintenta).
    odoo = { enviado: " Ya está en Odoo.", simulado: " Modo prueba: no se envía a Odoo.",
      sin_empleado: " No ha llegado a Odoo: falta su ficha de empleado (lo arregla la administración).",
      error: ` No ha llegado a Odoo${r?.detalle ? `: ${r.detalle}` : " (el servicio no responde: se reintentará sola)"}.` }[r?.estado ?? "error"] ?? "";
  }
  revalidatePath("/equipo");
  revalidatePath("/");
  return volver(aprobar ? `Ausencia aprobada.${odoo}` : "Ausencia rechazada.");
}

export async function corregirFichaje(form: FormData) {
  const { supabase, uid } = await conPermiso("fichaje.corregir");
  const usuario_id = String(form.get("usuario_id") ?? "");
  const tipo = String(form.get("tipo") ?? "");
  const nota = String(form.get("nota") ?? "").trim().slice(0, 300);
  const momento = madridAInstante(String(form.get("momento") ?? ""));
  if (!usuario_id || usuario_id === uid) return volver("Elige a otra persona: tus propios fichajes los corrige otro responsable.", "error");
  if (!["entrada", "pausa", "reanudar", "salida"].includes(tipo)) return volver("Elige el tipo de fichaje.", "error");
  if (!momento || momento.getTime() > Date.now()) return volver("La fecha y hora no pueden ser futuras.", "error");
  if (!nota) return volver("Explica el motivo de la corrección: queda en el registro de jornada.", "error");
  const { error } = await supabase.from("fichajes").insert({ usuario_id, tipo, momento: momento.toISOString(), origen: "correccion", nota });
  if (error) return volver("No se ha podido guardar la corrección.", "error");
  await llamarPython("/api/rrhh/fichajes/sincronizar", { method: "POST", body: { usuario_id } });
  revalidatePath("/equipo");
  return volver("Corrección anotada.");
}

export async function reintentarOdoo(form: FormData) {
  await conPermiso("fichaje.corregir");
  const usuario_id = String(form.get("usuario_id") ?? "");
  const r = await llamarPython<EnvioFichajes>("/api/rrhh/fichajes/sincronizar", { method: "POST", body: { usuario_id } });
  revalidatePath("/equipo");
  const { texto, bien } = resultadoEnvio(r, "su");
  return volver(bien ? texto : `${texto} Revisa el fichaje en Odoo.`, bien ? "ok" : "error");
}
