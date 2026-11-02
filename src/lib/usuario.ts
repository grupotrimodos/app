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
