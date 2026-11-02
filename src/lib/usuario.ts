import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Perfil = {
  id: string;
  nombre: string;
  email: string | null;
  codigo: string | null;
  activo: boolean;
  es_admin: boolean;
  modulos: string[];
};

/** Usuario con sesión y su fila de «usuarios». Sin sesión, al login. */
export async function usuarioActual() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) redirect("/login");
  const { data: perfil } = await supabase
    .from("usuarios")
    .select("id,nombre,email,codigo,activo,es_admin,modulos")
    .eq("id", uid)
    .maybeSingle<Perfil>();
  return { supabase, uid, perfil };
}

/** Usuario activo con el módulo indicado; si no, vuelve al inicio. */
export async function conModulo(modulo: string) {
  const r = await usuarioActual();
  if (!r.perfil?.activo || !r.perfil.modulos.includes(modulo)) redirect("/");
  return r as typeof r & { perfil: Perfil };
}

/** Centros en los que el usuario es responsable (todos si es administrador). */
export async function centrosQueGestiono(supabase: Awaited<ReturnType<typeof usuarioActual>>["supabase"], uid: string, esAdmin: boolean) {
  if (esAdmin) {
    const { data } = await supabase.from("centros").select("id,nombre").order("nombre");
    return (data ?? []) as { id: number; nombre: string }[];
  }
  const { data } = await supabase.from("usuario_centro_rol").select("centro_id, centros(id,nombre)")
    .eq("usuario_id", uid).eq("rol", "responsable");
  return ((data ?? []) as unknown as { centros: { id: number; nombre: string } }[]).map((r) => r.centros).filter(Boolean);
}
