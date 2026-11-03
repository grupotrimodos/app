"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { madridAInstante } from "@/lib/jornada";
import { GRAVEDAD, TIPOS_INCIDENCIA } from "@/lib/seguridad";
import { conPermiso } from "@/lib/usuario";

const volver = (msg: string, tipo: "ok" | "error" = "ok") => redirect(`/incidencias?${tipo}=${encodeURIComponent(msg)}`);
const numero = (v: FormDataEntryValue | null) => Number(v || 0) || null;

/** Cualquiera con el permiso reporta; la base de datos obliga a que sea a su nombre y quede «abierta». */
export async function reportarIncidencia(form: FormData) {
  const { supabase, uid } = await conPermiso("incidencias.reportar");
  const tipo = String(form.get("tipo") ?? "");
  const gravedad = String(form.get("gravedad") ?? "leve");
  const descripcion = String(form.get("descripcion") ?? "").trim().slice(0, 2000);
  if (!(tipo in TIPOS_INCIDENCIA) || !(gravedad in GRAVEDAD)) return volver("Elige el tipo y la gravedad.", "error");
  if (descripcion.length < 3) return volver("Cuenta qué ha pasado.", "error");
  const cuando = String(form.get("ocurrio") ?? "");
  const ocurrio = cuando ? madridAInstante(cuando) : new Date();
  if (!ocurrio || ocurrio.getTime() > Date.now() + 60_000) return volver("Revisa cuándo ocurrió.", "error");
  const { error } = await supabase.from("incidencias").insert({
    reportado_por: uid, tipo, gravedad, descripcion, ocurrio: ocurrio.toISOString(),
    lugar: String(form.get("lugar") ?? "").trim().slice(0, 120) || null,
    vehiculo_id: numero(form.get("vehiculo")),
  });
  if (error) return volver("No se ha podido enviar. Inténtalo de nuevo.", "error");
  revalidatePath("/incidencias");
  revalidatePath("/seguridad");
  volver("Incidencia enviada. La recibe el equipo de seguridad y la administración; aquí verás cuándo la cierran.");
}
