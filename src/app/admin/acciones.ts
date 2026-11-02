"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MODULOS, ROLES } from "@/lib/modulos";
import { CODIGO_RE, PIN_RE, correoDeCodigo } from "@/lib/pin";

const IDS_MODULOS = new Set(MODULOS.map((m) => m.id));

/** Cada acción vuelve a comprobar en el servidor que quien la lanza es administrador. */
async function exigirAdmin() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) redirect("/login");
  const { data: yo } = await supabase.from("usuarios").select("es_admin,activo").eq("id", uid).maybeSingle();
  if (!yo?.es_admin || !yo.activo) throw new Error("No tienes permiso.");
  return { supabase, uid };
}

const volver = (msg: string, tipo: "ok" | "error" = "ok") =>
  redirect(`/admin?${tipo}=${encodeURIComponent(msg)}`);

function leerModulos(form: FormData) {
  return form.getAll("modulos").map(String).filter((m) => IDS_MODULOS.has(m));
}

export async function crearUsuarioPin(form: FormData) {
  const { supabase } = await exigirAdmin();
  const nombre = String(form.get("nombre") ?? "").trim();
  const codigo = String(form.get("codigo") ?? "").trim().toUpperCase();
  const pin = String(form.get("pin") ?? "");
  const centro = Number(form.get("centro") || 0);
  const rol = String(form.get("rol") ?? "");
  if (!nombre) return volver("Falta el nombre.", "error");
  if (!CODIGO_RE.test(codigo)) return volver("El código debe tener de 3 a 20 letras o números.", "error");
  if (!PIN_RE.test(pin)) return volver("El PIN debe tener de 6 a 12 cifras.", "error");

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: correoDeCodigo(codigo), password: pin, email_confirm: true, user_metadata: { full_name: nombre },
  });
  if (error || !data.user) {
    return volver(error?.message?.includes("already") ? `El código ${codigo} ya existe.` : "No se ha podido crear el usuario.", "error");
  }
  const { error: e2 } = await supabase.from("usuarios")
    .update({ nombre, codigo, modulos: leerModulos(form), activo: true }).eq("id", data.user.id);
  if (e2) return volver("Usuario creado, pero no se han guardado sus datos. Revísalo.", "error");
  if (centro && (ROLES as readonly string[]).includes(rol)) {
    await supabase.from("usuario_centro_rol").insert({ usuario_id: data.user.id, centro_id: centro, rol });
  }
  revalidatePath("/admin");
  volver(`Usuario ${codigo} creado. Dale su código y su PIN.`);
}

export async function guardarUsuario(form: FormData) {
  const { supabase, uid } = await exigirAdmin();
  const id = String(form.get("id"));
  const cambios: Record<string, unknown> = {
    nombre: String(form.get("nombre") ?? "").trim(),
    activo: form.get("activo") === "on",
    es_admin: form.get("es_admin") === "on",
    modulos: leerModulos(form),
    odoo_employee_id: Number(form.get("odoo_employee_id")) || null,
  };
  if (id === uid && (!cambios.activo || !cambios.es_admin)) {
    return volver("No puedes quitarte a ti mismo el acceso de administrador.", "error");
  }
  const { error } = await supabase.from("usuarios").update(cambios).eq("id", id);
  if (error) return volver("No se han podido guardar los cambios.", "error");

  // Centro y rol: una fila por centro. Aquí se gestiona el centro principal elegido en el formulario.
  const centro = Number(form.get("centro") || 0);
  const rol = String(form.get("rol") ?? "");
  if (centro && (ROLES as readonly string[]).includes(rol)) {
    await supabase.from("usuario_centro_rol").upsert({ usuario_id: id, centro_id: centro, rol });
  }
  revalidatePath("/admin");
  volver("Cambios guardados.");
}

export async function quitarCentro(form: FormData) {
  const { supabase } = await exigirAdmin();
  await supabase.from("usuario_centro_rol").delete()
    .eq("usuario_id", String(form.get("id"))).eq("centro_id", Number(form.get("centro")));
  revalidatePath("/admin");
  volver("Centro quitado.");
}

export async function cambiarPin(form: FormData) {
  const { supabase } = await exigirAdmin();
  const id = String(form.get("id"));
  const pin = String(form.get("pin") ?? "");
  if (!PIN_RE.test(pin)) return volver("El PIN debe tener de 6 a 12 cifras.", "error");
  const { data: u } = await supabase.from("usuarios").select("codigo").eq("id", id).maybeSingle();
  if (!u?.codigo) return volver("Ese usuario entra con Microsoft: no tiene PIN.", "error");
  const { error } = await createAdminClient().auth.admin.updateUserById(id, { password: pin });
  if (error) return volver("No se ha podido cambiar el PIN.", "error");
  volver(`PIN de ${u.codigo} cambiado.`);
}

export async function crearCentro(form: FormData) {
  const { supabase } = await exigirAdmin();
  const nombre = String(form.get("nombre") ?? "").trim();
  if (!nombre) return volver("Falta el nombre del centro.", "error");
  const { error } = await supabase.from("centros").insert({ nombre });
  if (error) return volver(error.code === "23505" ? "Ese centro ya existe." : "No se ha podido crear el centro.", "error");
  revalidatePath("/admin");
  volver(`Centro «${nombre}» creado.`);
}

export async function crearVehiculo(form: FormData) {
  const { supabase } = await exigirAdmin();
  const matricula = String(form.get("matricula") ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const modelo = String(form.get("modelo") ?? "").trim() || null;
  const centro_id = Number(form.get("centro") || 0) || null;
  if (!/^[A-Z0-9 -]{4,12}$/.test(matricula)) return volver("Revisa la matrícula.", "error");
  const { error } = await supabase.from("vehiculos").insert({ matricula, modelo, centro_id });
  if (error) return volver(error.code === "23505" ? "Esa matrícula ya existe." : "No se ha podido añadir el camión.", "error");
  revalidatePath("/admin");
  volver(`Camión ${matricula} añadido.`);
}

export async function cambiarVehiculo(form: FormData) {
  const { supabase } = await exigirAdmin();
  const { error } = await supabase.from("vehiculos").update({ activo: form.get("activo") === "on" }).eq("id", Number(form.get("id")));
  if (error) return volver("No se ha podido guardar.", "error");
  revalidatePath("/admin");
  volver("Camión actualizado.");
}
