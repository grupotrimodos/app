"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { llamarPythonDetalle } from "@/lib/python";
import { conPermiso } from "@/lib/usuario";

export async function sincronizarAhora() {
  await conPermiso("admin.sincronizacion");
  const { error } = await llamarPythonDetalle("/api/odoo/procesar", { method: "POST", espera: 28000 });
  revalidatePath("/admin/sincronizacion");
  redirect(`/admin/sincronizacion?${error ? "error" : "ok"}=${encodeURIComponent(error ?? "Sincronización hecha. Mira el resultado abajo.")}`);
}
