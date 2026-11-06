"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conPermiso } from "@/lib/usuario";
import { hoyISO } from "@/lib/jornada";

const TIPOS = ["vacaciones", "asuntos_propios", "medico", "otro"];
const volver = (msg: string, tipo: "ok" | "error" = "ok") => redirect(`/ausencias?${tipo}=${encodeURIComponent(msg)}`);

export async function pedirAusencia(form: FormData) {
  const { supabase } = await conPermiso("ausencias.pedir");
  const tipo = String(form.get("tipo"));
  const desde = String(form.get("desde") ?? "");
  const hasta = String(form.get("hasta") ?? "") || desde;
  const motivo = String(form.get("motivo") ?? "").trim().slice(0, 300) || null;
  if (!TIPOS.includes(tipo)) return volver("Elige el tipo de ausencia.", "error");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return volver("Pon las fechas.", "error");
  if (hasta < desde) return volver("La fecha «hasta» no puede ser anterior a «desde».", "error");
  if (tipo !== "medico" && desde < hoyISO()) return volver("No se pueden pedir días ya pasados. Habla con tu responsable.", "error");
  const { error } = await supabase.from("ausencias").insert({ tipo, desde, hasta, motivo });
  // La base de datos no deja dos solicitudes vivas que se pisen (p. ej. por pulsar dos veces).
  if (error) return volver(error.code === "23P01" ? "Ya tienes una solicitud que coincide con esas fechas."
    : "No se ha podido enviar la solicitud.", "error");
  revalidatePath("/ausencias");
  volver("Solicitud enviada. Tu responsable la revisará.");
}

export async function anularAusencia(form: FormData) {
  const { supabase, uid } = await conPermiso("ausencias.pedir");
  const { data, error } = await supabase.from("ausencias").update({ estado: "anulada" })
    .eq("id", Number(form.get("id"))).eq("usuario_id", uid).eq("estado", "pendiente").select("id");
  if (error || !data?.length) return volver("No se ha podido anular (puede que ya esté resuelta).", "error");
  revalidatePath("/ausencias");
  volver("Solicitud anulada.");
}
