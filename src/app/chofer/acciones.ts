"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conPermiso } from "@/lib/usuario";
import { estadoDe, inicioDia, type Fichaje } from "@/lib/jornada";
import { llamarPython } from "@/lib/python";

const volver = (msg: string, tipo: "ok" | "error" = "ok") => redirect(`/chofer?${tipo}=${encodeURIComponent(msg)}`);

/** Cómo está la jornada; null si no se ha podido leer (entonces no se ficha nada a ciegas). */
async function estadoJornada(supabase: Awaited<ReturnType<typeof conPermiso>>["supabase"], uid: string) {
  const { data, error } = await supabase.from("fichajes").select("tipo,momento").eq("usuario_id", uid)
    .gte("momento", inicioDia(1).toISOString()).order("momento");
  return error ? null : estadoDe((data ?? []) as Fichaje[]);
}

async function cerrarAbierta(supabase: Awaited<ReturnType<typeof conPermiso>>["supabase"], uid: string) {
  // +2 s: el inicio lo pone el reloj de la base de datos; así el fin nunca queda antes que el inicio.
  const { error } = await supabase.from("asignaciones").update({ fin: new Date(Date.now() + 2000).toISOString() })
    .eq("usuario_id", uid).is("fin", null);
  return !error;
}

/** Empezar con un camión (el de la tarjeta o uno elegido). Si no había fichado, ficha la entrada a la vez. */
export async function empezarConCamion(form: FormData) {
  const { supabase, uid } = await conPermiso("chofer.usar");
  const vehiculo_id = Number(form.get("vehiculo_id"));
  const origen = form.get("origen") === "tacografo" ? "tacografo" : "manual";
  if (!vehiculo_id) return volver("Elige un camión.", "error");
  if (!(await cerrarAbierta(supabase, uid))) return volver("No se ha podido cerrar el camión anterior.", "error");
  const { error } = await supabase.from("asignaciones").insert({ vehiculo_id, origen });
  if (error) return volver("No se ha podido registrar el camión. Vuelve a elegirlo.", "error");
  revalidatePath("/chofer");
  const estado = await estadoJornada(supabase, uid);
  if (estado === null) return volver("Camión confirmado, pero no se ha podido comprobar tu jornada: ficha la entrada en «Fichaje».", "error");
  if (estado !== "fuera") return volver("Camión confirmado.");
  const { error: e } = await supabase.from("fichajes").insert({ tipo: "entrada", origen: "camion" });
  if (e) return volver("Camión confirmado, pero no se ha podido fichar la entrada: fíchala en «Fichaje».", "error");
  await llamarPython("/api/rrhh/fichajes/sincronizar", { method: "POST", body: {} });
  volver("Camión confirmado y entrada fichada. ¡Buen viaje!");
}

export async function finalizarJornada() {
  const { supabase, uid } = await conPermiso("chofer.usar");
  if (!(await cerrarAbierta(supabase, uid))) return volver("No se ha podido cerrar el camión.", "error");
  const estado = await estadoJornada(supabase, uid);
  if (estado === null) return volver("Camión cerrado, pero no se ha podido comprobar tu jornada: ficha la salida en «Fichaje».", "error");
  if (estado !== "fuera") {
    const { error } = await supabase.from("fichajes").insert({ tipo: "salida", origen: "camion" });
    if (error) return volver("Camión cerrado, pero no se ha podido fichar la salida. Fíchala en «Fichaje».", "error");
    await llamarPython("/api/rrhh/fichajes/sincronizar", { method: "POST", body: {} });
  }
  revalidatePath("/chofer");
  volver("Jornada terminada. ¡Buen descanso!");
}
