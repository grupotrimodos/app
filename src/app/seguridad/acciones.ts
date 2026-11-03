"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { guardarDocumento } from "@/lib/documentos";
import { ESTADO_INCIDENCIA, leerFecha, RESULTADO_REVISION, TIPOS_EQUIPO, TIPOS_REVISION } from "@/lib/seguridad";
import { conPermiso } from "@/lib/usuario";

/** Se vuelve a la misma pestaña del panel. */
const volver = (ver: string, msg: string, tipo: "ok" | "error" = "ok") =>
  redirect(`/seguridad?ver=${ver}&${tipo}=${encodeURIComponent(msg)}`);
const numero = (v: FormDataEntryValue | null) => Number(v || 0) || null;
const texto = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max) || null;

function hecho(ver: string, msg: string) {
  revalidatePath("/");
  revalidatePath("/seguridad");
  volver(ver, msg);
}

// ------------------------------------------------------------------ documentación

export async function guardarDocumentoVehiculo(form: FormData) {
  const { supabase } = await conPermiso("seguridad.gestionar", "vehiculos.gestionar");
  const id = numero(form.get("vehiculo"));
  if (!id) return volver("vehiculos", "Falta el camión.", "error");
  const error = await guardarDocumento(supabase, { vehiculo_id: id }, form);
  if (error) return volver("vehiculos", error, "error");
  hecho("vehiculos", "Documento del camión guardado.");
}

export async function guardarDocumentoPersona(form: FormData) {
  const { supabase } = await conPermiso("seguridad.gestionar");
  const id = String(form.get("usuario") ?? "");
  if (!id) return volver("personas", "Falta la persona.", "error");
  const error = await guardarDocumento(supabase, { usuario_id: id }, form);
  if (error) return volver("personas", error, "error");
  hecho("personas", "Documento guardado.");
}

// ------------------------------------------------------------------ carretillas, traspaletas e inspecciones

export async function crearEquipo(form: FormData) {
  const { supabase } = await conPermiso("seguridad.gestionar");
  const tipo = String(form.get("tipo") ?? "");
  const nombre = texto(form.get("nombre"), 60);
  if (!(tipo in TIPOS_EQUIPO) || !nombre) return volver("almacenes", "Pon el tipo y el número o nombre del equipo.", "error");
  const { error } = await supabase.from("equipos").insert({
    tipo, nombre, marca_modelo: texto(form.get("marca_modelo"), 80), centro_id: numero(form.get("centro")),
    proxima_revision: leerFecha(form.get("proxima_revision")),
  });
  if (error) return volver("almacenes", error.code === "23505" ? "Ya hay un equipo con ese tipo y nombre." : "No se ha podido añadir.", "error");
  hecho("almacenes", `${TIPOS_EQUIPO[tipo]} «${nombre}» añadida.`);
}

/** Una revisión queda registrada (no se cambia ni se borra) y fija la próxima del equipo. */
export async function anotarRevision(form: FormData) {
  const { supabase, uid } = await conPermiso("seguridad.gestionar");
  const equipo_id = numero(form.get("equipo"));
  const tipo = String(form.get("tipo") ?? "");
  const resultado = String(form.get("resultado") ?? "");
  const fecha = leerFecha(form.get("fecha"));
  if (!equipo_id || !(tipo in TIPOS_REVISION) || !(resultado in RESULTADO_REVISION) || !fecha) {
    return volver("almacenes", "Rellena la fecha, el tipo y el resultado de la revisión.", "error");
  }
  const { error } = await supabase.from("equipo_revisiones")
    .insert({ equipo_id, tipo, resultado, fecha, nota: texto(form.get("nota"), 500), creado_por: uid });
  if (error) return volver("almacenes", "No se ha podido anotar la revisión.", "error");
  const proxima = leerFecha(form.get("proxima_revision"));
  const cambios: Record<string, unknown> = {};
  if (proxima) cambios.proxima_revision = proxima;
  if (resultado === "fuera_de_servicio") cambios.activo = false;
  if (resultado === "correcto" && form.get("reactivar") === "on") cambios.activo = true;
  if (Object.keys(cambios).length) await supabase.from("equipos").update(cambios).eq("id", equipo_id);
  hecho("almacenes", resultado === "fuera_de_servicio" ? "Revisión anotada. El equipo queda fuera de servicio." : "Revisión anotada.");
}

export async function anotarInspeccion(form: FormData) {
  const { supabase, uid } = await conPermiso("seguridad.gestionar");
  const resultado = String(form.get("resultado") ?? "");
  const fecha = leerFecha(form.get("fecha"));
  const centro_id = numero(form.get("centro"));
  const lugar = texto(form.get("lugar"), 80);
  if (!["correcta", "con_deficiencias"].includes(resultado) || !fecha || (!centro_id && !lugar)) {
    return volver("almacenes", "Rellena el almacén, la fecha y el resultado de la inspección.", "error");
  }
  const deficiencias = texto(form.get("deficiencias"), 1000);
  if (resultado === "con_deficiencias" && !deficiencias) return volver("almacenes", "Apunta qué deficiencias hay.", "error");
  const { error } = await supabase.from("inspecciones").insert({
    centro_id, lugar, fecha, resultado, deficiencias, proxima: leerFecha(form.get("proxima")), realizada_por: uid,
  });
  if (error) return volver("almacenes", "No se ha podido anotar la inspección.", "error");
  hecho("almacenes", "Inspección anotada.");
}

// ------------------------------------------------------------------ incidencias

export async function seguirIncidencia(form: FormData) {
  const { supabase, uid } = await conPermiso("seguridad.gestionar");
  const id = numero(form.get("id"));
  const estado = String(form.get("estado") ?? "");
  if (!id || !(estado in ESTADO_INCIDENCIA)) return volver("incidencias", "Elige el estado.", "error");
  const medidas = texto(form.get("medidas"), 2000);
  if (estado === "cerrada" && !medidas) return volver("incidencias", "Para cerrarla, apunta qué se ha hecho.", "error");
  const cierre = estado === "cerrada" ? { cerrada_por: uid, cerrada_en: new Date().toISOString() } : { cerrada_por: null, cerrada_en: null };
  const { error } = await supabase.from("incidencias").update({ estado, medidas, ...cierre }).eq("id", id);
  if (error) return volver("incidencias", "No se ha podido guardar.", "error");
  hecho("incidencias", estado === "cerrada" ? "Incidencia cerrada." : "Incidencia actualizada.");
}
