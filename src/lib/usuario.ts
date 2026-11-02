import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { TODOS_LOS_PERMISOS, permisosDe } from "@/lib/permisos";

export type Perfil = {
  id: string;
  nombre: string;
  email: string | null;
  codigo: string | null;
  activo: boolean;
  es_admin: boolean;   // superadministrador: todos los permisos en todos los centros
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Usuario con sesión, su fila de «usuarios» y sus permisos (los de todos sus perfiles). Sin sesión, al login. */
export const usuarioActual = cache(async function usuarioActual() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) redirect("/login");
  const [{ data: perfil }, { data: lista }] = await Promise.all([
    supabase.from("usuarios").select("id,nombre,email,codigo,activo,es_admin").eq("id", uid).maybeSingle<Perfil>(),
    supabase.rpc("mis_permisos"),
  ]);
  const permisos = new Set<string>(!perfil?.activo ? [] : perfil.es_admin ? TODOS_LOS_PERMISOS : ((lista as string[] | null) ?? []));
  /** ¿Tiene alguno de estos permisos? */
  const puede = (...ps: string[]) => ps.some((p) => permisos.has(p));
  /** ¿Tiene algún permiso de esta área? (tarjeta del inicio y acceso a su página) */
  const veArea = (area: string) => puede(...permisosDe(area));
  return { supabase, uid, perfil, permisos, puede, veArea };
});

/** Usuario activo con alguno de los permisos indicados; si no, vuelve al inicio. */
export async function conPermiso(...ps: string[]) {
  const r = await usuarioActual();
  if (!r.perfil?.activo || !r.puede(...ps)) redirect("/");
  return r as typeof r & { perfil: Perfil };
}

/** Centros en los que el usuario tiene alguno de estos permisos. Todos si es superadministrador o si alguno de
 *  sus perfiles con ese permiso vale «en todos los centros». */
export async function centrosConPermiso(supabase: Supabase, uid: string, esAdmin: boolean, ps: string[]) {
  const todos = async () => {
    const { data } = await supabase.from("centros").select("id,nombre").order("nombre");
    return (data ?? []) as { id: number; nombre: string }[];
  };
  if (esAdmin) return todos();
  const { data } = await supabase.from("usuario_perfil")
    .select("centro_id, perfiles(permisos,todos_los_centros), centros(id,nombre)").eq("usuario_id", uid);
  type Fila = { centro_id: number | null; perfiles: { permisos: string[]; todos_los_centros: boolean }; centros: { id: number; nombre: string } | null };
  const conPermiso = ((data ?? []) as unknown as Fila[]).filter((f) => f.perfiles?.permisos.some((p) => ps.includes(p)));
  if (conPermiso.some((f) => f.perfiles.todos_los_centros)) return todos();
  const vistos = new Map<number, { id: number; nombre: string }>();
  for (const f of conPermiso) if (f.centros) vistos.set(f.centros.id, f.centros);
  return [...vistos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}
