"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conPermiso } from "@/lib/usuario";

const volver = (msg: string, tipo: "ok" | "error" = "ok") => redirect(`/equipo/zonas?${tipo}=${encodeURIComponent(msg)}`);

export async function crearZona(form: FormData) {
  const { supabase } = await conPermiso("zonas.gestionar");
  const nombre = String(form.get("nombre") ?? "").trim().slice(0, 80);
  const tipo = form.get("tipo") === "ruta" ? "ruta" : "cliente";
  const descripcion = String(form.get("descripcion") ?? "").trim().slice(0, 200) || null;
  if (nombre.length < 2) return volver("Pon el nombre del cliente o de la ruta.", "error");
  const { error } = await supabase.from("zonas").insert({ nombre, tipo, descripcion });
  if (error) return volver(error.code === "23505" ? "Ya hay una zona con ese nombre." : "No se ha podido crear la zona.", "error");
  revalidatePath("/equipo/zonas");
  volver(`Zona «${nombre}» creada. Ahora asígnale sus chóferes.`);
}

/** Activar o retirar una zona (no se borra: sus datos siguen en el histórico). */
export async function cambiarZona(form: FormData) {
  const { supabase } = await conPermiso("zonas.gestionar");
  const activo = form.get("activo") === "1";
  const { error } = await supabase.from("zonas").update({ activo }).eq("id", Number(form.get("id")));
  if (error) return volver("No se ha podido cambiar la zona.", "error");
  revalidatePath("/equipo/zonas");
  volver(activo ? "Zona activada." : "Zona retirada: ya no sale en el cuadro de mando.");
}

/** Guarda de una vez la zona de todos los chóferes de la lista (zona_<id> = id de la zona o vacío). */
export async function asignarZonas(form: FormData) {
  const { supabase } = await conPermiso("zonas.gestionar");
  const cambios = [...form.entries()].filter(([k]) => k.startsWith("zona_") && /^[0-9a-f-]{36}$/.test(k.slice(5)))
    .map(([k, v]) => ({ usuario_id: k.slice(5), zona_id: Number(v) || null, antes: Number(form.get(`antes_${k.slice(5)}`)) || null }))
    .filter((c) => c.zona_id !== c.antes);
  if (!cambios.length) return volver("No has cambiado nada.");
  const poner = cambios.filter((c) => c.zona_id).map(({ usuario_id, zona_id }) => ({ usuario_id, zona_id, asignado_en: new Date().toISOString() }));
  const quitar = cambios.filter((c) => !c.zona_id).map((c) => c.usuario_id);
  const [a, b] = await Promise.all([
    poner.length ? supabase.from("chofer_zona").upsert(poner).select("usuario_id") : Promise.resolve({ data: [], error: null }),
    quitar.length ? supabase.from("chofer_zona").delete().in("usuario_id", quitar).select("usuario_id") : Promise.resolve({ data: [], error: null }),
  ]);
  const hechos = (a.data?.length ?? 0) + (b.data?.length ?? 0);
  revalidatePath("/equipo/zonas");
  revalidatePath("/");
  if (a.error || b.error || hechos < cambios.length) return volver(`Guardados ${hechos} de ${cambios.length} cambios: el resto no son de tus centros.`, "error");
  volver(`${hechos} ${hechos === 1 ? "chófer actualizado" : "chóferes actualizados"}.`);
}
