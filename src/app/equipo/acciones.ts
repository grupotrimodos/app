"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conPermiso } from "@/lib/usuario";
import { madridAInstante } from "@/lib/jornada";
import { llamarPython } from "@/lib/python";

const volver = (msg: string, tipo: "ok" | "error" = "ok") => redirect(`/equipo?${tipo}=${encodeURIComponent(msg)}`);


// Cada acción exige su permiso; además, la base de datos solo deja actuar sobre personas de los centros propios.
export async function resolverAusencia(form: FormData) {
  const { supabase, uid } = await conPermiso("ausencias.aprobar");
  const id = Number(form.get("id"));
  const aprobar = form.get("decision") === "aprobar";
  const comentario = String(form.get("comentario") ?? "").trim().slice(0, 300) || null;
  // Los permisos de la base de datos impiden resolver las propias o las de fuera de tus centros.
  const { data, error } = await supabase.from("ausencias")
    .update({ estado: aprobar ? "aprobada" : "rechazada", resuelto_por: uid, resuelto_en: new Date().toISOString(), comentario,
      odoo_estado: aprobar ? "pendiente" : "no_aplica" })
    .eq("id", id).eq("estado", "pendiente").select("id");
  if (error || !data?.length) return volver("No se ha podido resolver (puede que ya esté resuelta o no sea de tu equipo).", "error");
  if (aprobar) await llamarPython(`/api/rrhh/ausencias/${id}/sincronizar`, { method: "POST" });
  revalidatePath("/equipo");
  volver(aprobar ? "Ausencia aprobada." : "Ausencia rechazada.");
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
  volver("Corrección anotada.");
}

export async function reintentarOdoo(form: FormData) {
  await conPermiso("fichaje.corregir");
  const usuario_id = String(form.get("usuario_id") ?? "");
  const r = await llamarPython<{ errores: number }>("/api/rrhh/fichajes/sincronizar", { method: "POST", body: { usuario_id } });
  revalidatePath("/equipo");
  volver(r && r.errores === 0 ? "Enviado a Odoo." : "Odoo sigue sin aceptarlo: revisa el fichaje en Odoo.", r && r.errores === 0 ? "ok" : "error");
}
