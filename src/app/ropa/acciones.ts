"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { leerLineas, MOTIVOS_ROPA } from "@/lib/ropa";
import { conPermiso } from "@/lib/usuario";

const volver = (msg: string, tipo: "ok" | "error" = "ok") => redirect(`/ropa?${tipo}=${encodeURIComponent(msg)}`);

function hecho(msg: string) {
  revalidatePath("/");
  revalidatePath("/ropa");
  volver(msg);
}

/** Cada uno pide para sí mismo; la base de datos lo exige y deja la solicitud «pendiente». */
export async function pedirRopa(form: FormData) {
  const { supabase, uid } = await conPermiso("ropa.pedir");
  const prendas = leerLineas(form);
  if (typeof prendas === "string") return volver(prendas, "error");
  const motivo = String(form.get("motivo") ?? "");
  if (!(motivo in MOTIVOS_ROPA)) return volver("Elige el motivo.", "error");
  const nota = String(form.get("nota") ?? "").trim().slice(0, 500) || null;
  const { error } = await supabase.from("solicitudes_ropa").insert({ usuario_id: uid, prendas, motivo, nota });
  if (error) return volver("No se ha podido enviar. Inténtalo de nuevo.", "error");
  hecho("Pedido enviado a tu responsable.");
}

export async function anularRopa(form: FormData) {
  const { supabase, uid } = await conPermiso("ropa.pedir");
  const { data } = await supabase.from("solicitudes_ropa").update({ estado: "anulada" })
    .eq("id", Number(form.get("id"))).eq("usuario_id", uid).eq("estado", "pendiente").select("id");
  if (!data?.length) return volver("Ya no se puede anular: tu responsable ya la ha resuelto.", "error");
  hecho("Pedido anulado.");
}

/** El responsable aprueba o rechaza (nunca lo suyo: lo impide la base de datos). */
export async function resolverRopa(form: FormData) {
  const { supabase, uid } = await conPermiso("ropa.gestionar");
  const aprobar = form.get("decision") === "aprobar";
  const comentario = String(form.get("comentario") ?? "").trim().slice(0, 300) || null;
  if (!aprobar && !comentario) return volver("Para rechazarlo, explica el motivo en el comentario.", "error");
  const { data } = await supabase.from("solicitudes_ropa")
    .update({ estado: aprobar ? "aprobada" : "rechazada", resuelto_por: uid, resuelto_en: new Date().toISOString(), comentario })
    .eq("id", Number(form.get("id"))).eq("estado", "pendiente").select("id");
  if (!data?.length) return volver("No se ha podido resolver (puede que ya esté resuelto o no sea de tu equipo).", "error");
  hecho(aprobar ? "Pedido aprobado. Márcalo como entregado cuando se lo des." : "Pedido rechazado.");
}

export async function entregarRopa(form: FormData) {
  const { supabase, uid } = await conPermiso("ropa.gestionar");
  const { data } = await supabase.from("solicitudes_ropa")
    .update({ estado: "entregada", entregado_por: uid, entregado_en: new Date().toISOString() })
    .eq("id", Number(form.get("id"))).eq("estado", "aprobada").select("id");
  if (!data?.length) return volver("No se ha podido marcar como entregado.", "error");
  hecho("Marcado como entregado.");
}
