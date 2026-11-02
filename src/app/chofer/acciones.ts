"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conModulo } from "@/lib/usuario";
import { estadoDe, inicioDia, type Fichaje } from "@/lib/jornada";
import { llamarPython } from "@/lib/python";

const volver = (msg: string, tipo: "ok" | "error" = "ok") => redirect(`/chofer?${tipo}=${encodeURIComponent(msg)}`);

async function estadoJornada(supabase: Awaited<ReturnType<typeof conModulo>>["supabase"], uid: string) {
  const { data } = await supabase.from("fichajes").select("tipo,momento").eq("usuario_id", uid)
    .gte("momento", inicioDia(1).toISOString()).order("momento");
  return estadoDe((data ?? []) as Fichaje[]);
}

async function cerrarAbierta(supabase: Awaited<ReturnType<typeof conModulo>>["supabase"], uid: string) {
  // +2 s: el inicio lo pone el reloj de la base de datos; así el fin nunca queda antes que el inicio.
  const { error } = await supabase.from("asignaciones").update({ fin: new Date(Date.now() + 2000).toISOString() })
    .eq("usuario_id", uid).is("fin", null);
  return !error;
}

/** Empezar con un camión (el de la tarjeta o uno elegido). Si no había fichado, ficha la entrada a la vez. */
export async function empezarConCamion(form: FormData) {
  const { supabase, uid } = await conModulo("chofer");
  const vehiculo_id = Number(form.get("vehiculo_id"));
  const origen = form.get("origen") === "tacografo" ? "tacografo" : "manual";
  if (!vehiculo_id) return volver("Elige un camión.", "error");
  if (!(await cerrarAbierta(supabase, uid))) return volver("No se ha podido cerrar el camión anterior.", "error");
  const { error } = await supabase.from("asignaciones").insert({ vehiculo_id, origen });
  if (error) return volver("No se ha podido registrar el camión. Vuelve a elegirlo.", "error");
  let fichado = false;
  if ((await estadoJornada(supabase, uid)) === "fuera") {
    const { error: e } = await supabase.from("fichajes").insert({ tipo: "entrada", origen: "camion" });
    fichado = !e;
    if (fichado) await llamarPython("/api/rrhh/fichajes/sincronizar", { method: "POST", body: {} });
  }
  revalidatePath("/chofer");
  volver(fichado ? "Camión confirmado y entrada fichada. ¡Buen viaje!" : "Camión confirmado.");
}

export async function finalizarJornada() {
  const { supabase, uid } = await conModulo("chofer");
  if (!(await cerrarAbierta(supabase, uid))) return volver("No se ha podido cerrar el camión.", "error");
  if ((await estadoJornada(supabase, uid)) !== "fuera") {
    const { error } = await supabase.from("fichajes").insert({ tipo: "salida", origen: "camion" });
    if (error) return volver("Camión cerrado, pero no se ha podido fichar la salida. Fíchala en «Fichaje».", "error");
    await llamarPython("/api/rrhh/fichajes/sincronizar", { method: "POST", body: {} });
  }
  revalidatePath("/chofer");
  volver("Jornada terminada. ¡Buen descanso!");
}
