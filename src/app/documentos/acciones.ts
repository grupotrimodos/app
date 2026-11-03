"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { guardarDocumento } from "@/lib/documentos";
import { conPermiso } from "@/lib/usuario";

const volver = (msg: string, tipo: "ok" | "error" = "ok") => redirect(`/documentos?${tipo}=${encodeURIComponent(msg)}`);

/** Cada uno guarda SOLO su documentación (la base de datos no le deja tocar la de otros). */
export async function guardarMiDocumento(form: FormData) {
  const { supabase, uid } = await conPermiso("documentos.propios");
  const error = await guardarDocumento(supabase, { usuario_id: uid }, form);
  if (error) return volver(error, "error");
  revalidatePath("/");
  revalidatePath("/documentos");
  volver("Documento guardado.");
}
