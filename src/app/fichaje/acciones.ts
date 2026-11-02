"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conPermiso } from "@/lib/usuario";
import { estadoDe, inicioDia, SIGUIENTES, type Fichaje } from "@/lib/jornada";
import { llamarPython } from "@/lib/python";

const volver = (msg: string, tipo: "ok" | "error" = "ok") => redirect(`/fichaje?${tipo}=${encodeURIComponent(msg)}`);

/** Fichar ahora. Se comprueba en el servidor que el paso tiene sentido (no se puede salir sin haber entrado). */
export async function fichar(form: FormData) {
  const { supabase, uid } = await conPermiso("fichaje.fichar");
  const tipo = String(form.get("tipo")) as Fichaje["tipo"];
  const { data } = await supabase.from("fichajes").select("tipo,momento").eq("usuario_id", uid)
    .gte("momento", inicioDia(1).toISOString()).order("momento");
  const estado = estadoDe((data ?? []) as Fichaje[]);
  if (!SIGUIENTES[estado].includes(tipo)) return volver("Ese fichaje no corresponde ahora. Recarga la página.", "error");
  const { error } = await supabase.from("fichajes").insert({ tipo, origen: "app" });
  if (error) return volver("No se ha podido fichar. Inténtalo de nuevo.", "error");
  await llamarPython("/api/rrhh/fichajes/sincronizar", { method: "POST", body: {} });
  revalidatePath("/fichaje");
  volver({ entrada: "Entrada fichada.", pausa: "Pausa anotada.", reanudar: "Vuelta anotada.", salida: "Salida fichada. ¡Hasta mañana!" }[tipo]);
}

export async function reintentarOdoo() {
  await conPermiso("fichaje.fichar", "chofer.usar");
  const r = await llamarPython<{ enviados: number; errores: number }>("/api/rrhh/fichajes/sincronizar", { method: "POST", body: {} });
  revalidatePath("/fichaje");
  volver(r && r.errores === 0 ? "Enviado a Odoo." : "Odoo sigue sin aceptarlo. Avisa a tu responsable.", r && r.errores === 0 ? "ok" : "error");
}
