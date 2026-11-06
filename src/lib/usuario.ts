import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { AREAS, DE_PUESTO, RANGO_PANTALLA, TODOS_LOS_PERMISOS, permisosDe, type Pantalla } from "@/lib/permisos";

export type Perfil = {
  id: string;
  nombre: string;
  email: string | null;
  codigo: string | null;
  activo: boolean;
  es_admin: boolean;   // superadministrador: todos los permisos en todos los centros
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Usuario con sesión, su fila de «usuarios», sus permisos (los de todos sus perfiles) y su pantalla. Sin sesión, al login. */
export const usuarioActual = cache(async function usuarioActual() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) redirect("/login");
  const [{ data: perfil }, { data: lista }, { data: suyos }] = await Promise.all([
    supabase.from("usuarios").select("id,nombre,email,codigo,activo,es_admin").eq("id", uid).maybeSingle<Perfil>(),
    supabase.rpc("mis_permisos"),
    supabase.from("usuario_perfil").select("perfiles(pantalla)").eq("usuario_id", uid)
      .returns<{ perfiles: { pantalla: Pantalla | null } | null }[]>(),
  ]);
  /** Los de sus perfiles: dicen qué hace en su puesto (un superadministrador puede todo, pero no por eso conduce). */
  const propios = new Set<string>(!perfil?.activo ? [] : ((lista as string[] | null) ?? []));
  const permisos = perfil?.activo && perfil.es_admin ? new Set<string>(TODOS_LOS_PERMISOS) : propios;
  /** ¿Tiene alguno de estos permisos? */
  const puede = (...ps: string[]) => ps.some((p) => permisos.has(p));
  /** ¿Tiene alguno de estos permisos en sus perfiles? Para lo personal del puesto: su camión, su documentación. */
  const esDeSuPuesto = (...ps: string[]) => ps.some((p) => propios.has(p));
  /** ¿Tiene algún permiso de esta área? (acceso a su página) */
  const veArea = (area: string) => puede(...permisosDe(area));
  /** ¿Sale en su menú? Los permisos de gestión cuentan siempre; los del trabajo propio (fichar, la flota, DECA…), solo si
   *  vienen de sus perfiles: al superadministrador no se le llena el menú con lo de otros puestos. */
  const enMenu = (area: string) => {
    const a = AREAS.find((x) => x.id === area);
    if (!a || (area === "direccion" && pantalla === "direccion")) return false;   // en dirección, el cuadro es el inicio
    return a.permisos.some((p) => (DE_PUESTO.has(p.id) ? propios.has(p.id) : permisos.has(p.id)));
  };
  /** Qué ve al entrar: la pantalla de más alcance de sus perfiles. Sin puesto pero con complementos (Seguridad…), la de
   *  oficina; el superadministrador sin perfiles, la de dirección; sin nada, ninguna (pantalla de «preparando tu acceso»). */
  const pantallas = (suyos ?? []).map((f) => f.perfiles?.pantalla).filter((p): p is Pantalla => !!p);
  const pantalla: Pantalla | null = !perfil?.activo ? null
    : pantallas.length ? pantallas.reduce((a, b) => (RANGO_PANTALLA[b] > RANGO_PANTALLA[a] ? b : a))
    : perfil.es_admin ? "direccion" : propios.size ? "oficina" : null;
  return { supabase, uid, perfil, permisos, puede, esDeSuPuesto, veArea, enMenu, pantalla };
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
  return (await alcanceCentros(supabase, uid, esAdmin, ps)).centros;
}

/** Como centrosConPermiso, y además si vale en todos (entonces también alcanza a quien todavía no tiene centro). */
export async function alcanceCentros(supabase: Supabase, uid: string, esAdmin: boolean, ps: string[]) {
  const todosLos = async () => {
    const { data } = await supabase.from("centros").select("id,nombre").order("nombre");
    return { centros: (data ?? []) as { id: number; nombre: string }[], todos: true };
  };
  if (esAdmin) return todosLos();
  const { data } = await supabase.from("usuario_perfil")
    .select("centro_id, perfiles(permisos,todos_los_centros), centros(id,nombre)").eq("usuario_id", uid);
  type Fila = { centro_id: number | null; perfiles: { permisos: string[]; todos_los_centros: boolean }; centros: { id: number; nombre: string } | null };
  const conPermiso = ((data ?? []) as unknown as Fila[]).filter((f) => f.perfiles?.permisos.some((p) => ps.includes(p)));
  if (conPermiso.some((f) => f.perfiles.todos_los_centros)) return todosLos();
  const vistos = new Map<number, { id: number; nombre: string }>();
  for (const f of conPermiso) if (f.centros) vistos.set(f.centros.id, f.centros);
  return { centros: [...vistos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)), todos: false };
}
