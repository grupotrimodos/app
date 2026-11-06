"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { leerKit, leerLineas, leerTallas, MOTIVOS_CAMBIO } from "@/lib/ropa";
import { conPermiso } from "@/lib/usuario";

/** Vuelve a la pantalla de origen (el inicio del móvil o la de ropa, con su pestaña) con el mensaje. */
function volver(msg: string, tipo: "ok" | "error" = "ok", form?: FormData) {
  const destino = String(form?.get("volver") ?? "");
  const base = /^\/(ropa)?(\?ver=[a-z]+)?$/.test(destino) ? destino : "/ropa";
  redirect(`${base}${base.includes("?") ? "&" : "?"}${tipo}=${encodeURIComponent(msg)}`);
}

function hecho(msg: string, form?: FormData) {
  revalidatePath("/");
  revalidatePath("/ropa");
  volver(msg, "ok", form);
}

/** Tallas: cada uno las suyas; el responsable, las de las personas de sus centros (la base de datos lo comprueba). */
export async function guardarTallas(form: FormData) {
  const { supabase, uid } = await conPermiso("ropa.pedir", "ropa.gestionar");
  const de = String(form.get("usuario") ?? "") || uid;
  const tallas = leerTallas(form);
  if (!Object.keys(tallas).length) return volver("Elige al menos una talla.", "error", form);
  const { data: antes } = await supabase.from("tallas_ropa").select("tallas").eq("usuario_id", de).maybeSingle<{ tallas: object }>();
  const { error } = await supabase.from("tallas_ropa")
    .upsert({ usuario_id: de, tallas: { ...(antes?.tallas ?? {}), ...tallas }, actualizado: new Date().toISOString() });
  if (error) return volver("No se han podido guardar las tallas.", "error", form);
  hecho(de === uid ? "Tallas guardadas. Tu responsable ya sabe qué prepararte." : "Tallas guardadas.", form);
}

/** La persona confirma que ha recibido su ropa de temporada. */
export async function confirmarDotacion(form: FormData) {
  const { supabase } = await conPermiso("ropa.pedir");
  const { error } = await supabase.rpc("confirmar_dotacion", { dotacion: Number(form.get("id")) });
  if (error) return volver("No se ha podido confirmar: puede que ya estuviera confirmada.", "error", form);
  hecho("Gracias: queda apuntado que tienes tu ropa.", form);
}

/** El responsable la marca como entregada (o deshace la entrega si se equivocó). Nunca la suya: lo impide la base de datos. */
export async function entregarDotacion(form: FormData) {
  const { supabase } = await conPermiso("ropa.gestionar");
  const entregada = form.get("deshacer") !== "1";
  const { error } = await supabase.rpc("entregar_dotacion", { dotacion: Number(form.get("id")), entregada });
  if (error) return volver(entregada ? "No se ha podido marcar como entregada." : "Ya no se puede deshacer: la persona la ha confirmado.", "error", form);
  hecho(entregada ? "Marcada como entregada. La persona tiene que confirmarlo." : "Entrega deshecha.", form);
}

/** Composición de la muda de un puesto en una temporada y cuántas mudas tocan. */
export async function guardarKit(form: FormData) {
  const { supabase } = await conPermiso("ropa.configurar");
  const perfil = Number(form.get("perfil"));
  const temporada = String(form.get("temporada"));
  const mudas = Number(form.get("mudas"));
  if (!["verano", "invierno"].includes(temporada) || !Number.isInteger(mudas) || mudas < 0 || mudas > 6) {
    return volver("Revisa la temporada y el número de mudas.", "error", form);
  }
  const { error } = await supabase.from("ropa_kits")
    .upsert({ perfil_id: perfil, temporada, prendas: leerKit(form), mudas }, { onConflict: "perfil_id,temporada" });
  if (error) return volver("No se ha podido guardar la composición.", "error", form);
  // Las dotaciones aún sin entregar se ajustan solas a la nueva composición.
  await supabase.rpc("preparar_dotaciones");
  hecho("Composición guardada. Las dotaciones sin entregar ya la tienen.", form);
}

/** Cada uno pide para sí mismo; la base de datos lo exige y deja la solicitud «pendiente». */
export async function pedirRopa(form: FormData) {
  const { supabase, uid } = await conPermiso("ropa.pedir");
  const prendas = leerLineas(form);
  if (typeof prendas === "string") return volver(prendas, "error");
  const motivo = String(form.get("motivo") ?? "");
  if (!(MOTIVOS_CAMBIO as readonly string[]).includes(motivo)) return volver("Elige el motivo.", "error");
  const nota = String(form.get("nota") ?? "").trim().slice(0, 500) || null;
  const { error } = await supabase.from("solicitudes_ropa").insert({ usuario_id: uid, prendas, motivo, nota });
  if (error) return volver("No se ha podido enviar. Inténtalo de nuevo.", "error");
  hecho("Cambio pedido a tu responsable.");
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
  const decision = form.get("decision");
  if (decision !== "aprobar" && decision !== "rechazar") return volver("Pulsa «Aprobar» o «Rechazar».", "error");
  const aprobar = decision === "aprobar";
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
