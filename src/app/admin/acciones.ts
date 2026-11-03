"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { esPermiso } from "@/lib/permisos";
import { DOCUMENTOS_PERSONA } from "@/lib/seguridad";
import { CODIGO_RE, DOMINIO_PIN, PIN_RE, correoDeCodigo } from "@/lib/pin";
import { usuarioActual } from "@/lib/usuario";

/** Cada acción vuelve a comprobar en el servidor el permiso de quien la lanza (y la base de datos lo exige otra vez). */
async function exigir(permiso: string) {
  const r = await usuarioActual();
  if (!r.perfil?.activo || !r.puede(permiso)) throw new Error("No tienes permiso.");
  return r as typeof r & { perfil: NonNullable<typeof r.perfil> };
}

const volver = (msg: string, tipo: "ok" | "error" = "ok") =>
  redirect(`/admin?${tipo}=${encodeURIComponent(msg)}`);

const numero = (v: FormDataEntryValue | null) => Number(v || 0) || null;

// ------------------------------------------------------------------ usuarios

export async function crearUsuarioPin(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  const nombre = String(form.get("nombre") ?? "").trim();
  const codigo = String(form.get("codigo") ?? "").trim().toUpperCase();
  const pin = String(form.get("pin") ?? "");
  const perfil = numero(form.get("perfil"));
  const centro = numero(form.get("centro"));
  if (!nombre) return volver("Falta el nombre.", "error");
  if (!CODIGO_RE.test(codigo)) return volver("El código debe tener de 3 a 20 letras o números.", "error");
  if (!PIN_RE.test(pin)) return volver("El PIN debe tener de 6 a 12 cifras.", "error");
  if (!perfil || !centro) return volver("Elige su perfil y su centro: así sus solicitudes le llegan a su responsable.", "error");

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: correoDeCodigo(codigo), password: pin, email_confirm: true, user_metadata: { full_name: nombre },
  });
  if (error || !data.user) {
    return volver(error?.message?.includes("already") ? `El código ${codigo} ya existe.` : "No se ha podido crear el usuario.", "error");
  }
  // El código de acceso solo lo fija el servidor al crear la cuenta (desde la app, solo un superadministrador lo cambia).
  const { error: e2 } = await admin.from("usuarios").update({ nombre, codigo, activo: true }).eq("id", data.user.id);
  if (e2) {
    // Nunca una cuenta a medias (con acceso pero sin código ni perfil): se deshace y se puede volver a intentar.
    await admin.auth.admin.deleteUser(data.user.id);
    return volver("No se ha podido crear el usuario. No se ha guardado nada: inténtalo de nuevo.", "error");
  }
  const { error: e3 } = await supabase.from("usuario_perfil").insert({ usuario_id: data.user.id, perfil_id: perfil, centro_id: centro });
  revalidatePath("/admin");
  if (e3) return volver(`Usuario ${codigo} creado, pero no se le ha podido asignar el perfil. Asígnaselo en su ficha.`, "error");
  volver(`Usuario ${codigo} creado. Dale su código y su PIN.`);
}

export async function guardarUsuario(form: FormData) {
  const { supabase, uid, perfil: yo } = await exigir("admin.usuarios");
  const id = String(form.get("id"));
  const cambios: Record<string, unknown> = {
    nombre: String(form.get("nombre") ?? "").trim(),
    activo: form.get("activo") === "on",
    odoo_employee_id: numero(form.get("odoo_employee_id")),
  };
  // Solo un superadministrador nombra a otros (la base de datos también lo impide).
  if (yo.es_admin) cambios.es_admin = form.get("es_admin") === "on";
  if (id === uid && (!cambios.activo || (yo.es_admin && !cambios.es_admin))) {
    return volver("No puedes quitarte a ti mismo el acceso.", "error");
  }
  const { error } = await supabase.from("usuarios").update(cambios).eq("id", id);
  if (error) return volver("No se han podido guardar los cambios (a un superadministrador solo lo cambia otro).", "error");
  revalidatePath("/admin");
  volver("Cambios guardados.");
}

/** Un puesto o un responsable trabaja sobre un centro; sin él, nadie recibe lo que pide esa persona (o no tiene a nadie
 *  a su cargo). Solo los perfiles marcados «todos los centros» (p. ej. Seguridad) van sin centro. */
async function exigirCentro(supabase: Awaited<ReturnType<typeof exigir>>["supabase"], perfil: number, centro: number | null) {
  if (centro) return null;
  const { data } = await supabase.from("perfiles").select("nombre,todos_los_centros").eq("id", perfil)
    .maybeSingle<{ nombre: string; todos_los_centros: boolean }>();
  return data?.todos_los_centros ? null : `Elige el centro: el perfil «${data?.nombre ?? ""}» trabaja sobre un centro.`;
}

/** Deja lista a una persona sin perfil: le asigna puesto y centro y la activa, en un solo paso. */
export async function configurarUsuario(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  const id = String(form.get("id"));
  const perfil = numero(form.get("perfil"));
  const centro = numero(form.get("centro"));
  if (!perfil) return volver("Elige su perfil.", "error");
  const falta = await exigirCentro(supabase, perfil, centro);
  if (falta) return volver(falta, "error");
  const { error } = await supabase.from("usuario_perfil").insert({ usuario_id: id, perfil_id: perfil, centro_id: centro });
  if (error) return volver("No se ha podido asignar el perfil.", "error");
  const { error: e2 } = await supabase.from("usuarios").update({ activo: true }).eq("id", id);
  revalidatePath("/admin");
  revalidatePath("/");
  if (e2) return volver("Perfil asignado, pero no se ha podido activar. Actívalo en su ficha.", "error");
  volver("Listo: ya puede entrar y ve lo de su puesto.");
}

export async function asignarPerfil(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  const perfil = numero(form.get("perfil"));
  if (!perfil) return volver("Elige un perfil.", "error");
  const falta = await exigirCentro(supabase, perfil, numero(form.get("centro")));
  if (falta) return volver(falta, "error");
  const { error } = await supabase.from("usuario_perfil")
    .insert({ usuario_id: String(form.get("id")), perfil_id: perfil, centro_id: numero(form.get("centro")) });
  if (error) return volver(error.code === "23505" ? "Ya tiene ese perfil en ese centro." : "No se ha podido asignar el perfil.", "error");
  revalidatePath("/admin");
  volver("Perfil asignado.");
}

export async function quitarPerfil(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  await supabase.from("usuario_perfil").delete().eq("id", Number(form.get("asignacion")));
  revalidatePath("/admin");
  volver("Perfil quitado.");
}

export async function cambiarPin(form: FormData) {
  const { supabase, perfil: yo } = await exigir("admin.usuarios");
  const id = String(form.get("id"));
  const pin = String(form.get("pin") ?? "");
  if (!PIN_RE.test(pin)) return volver("El PIN debe tener de 6 a 12 cifras.", "error");
  const { data: u } = await supabase.from("usuarios").select("codigo,es_admin").eq("id", id).maybeSingle();
  if (!u) return volver("No encontramos a ese usuario.", "error");
  if (u.es_admin && !yo.es_admin) return volver("El PIN de un superadministrador solo lo cambia otro superadministrador.", "error");
  // Solo cuentas de código + PIN (correo interno): nunca se pone contraseña a una cuenta de Microsoft.
  const admin = createAdminClient();
  const { data: cuenta } = await admin.auth.admin.getUserById(id);
  if (!cuenta.user?.email?.toLowerCase().endsWith(`@${DOMINIO_PIN}`)) return volver("Ese usuario entra con Microsoft: no tiene PIN.", "error");
  const { error } = await admin.auth.admin.updateUserById(id, { password: pin });
  if (error) return volver("No se ha podido cambiar el PIN.", "error");
  volver(`PIN de ${u.codigo} cambiado.`);
}

// ------------------------------------------------------------------ perfiles

function leerPerfil(form: FormData) {
  const datos = {
    nombre: String(form.get("nombre") ?? "").trim(),
    descripcion: String(form.get("descripcion") ?? "").trim() || null,
    permisos: [...new Set(form.getAll("permisos").map(String).filter(esPermiso))],
    todos_los_centros: form.get("todos_los_centros") === "on",
    documentos: [...new Set(form.getAll("documentos").map(String).filter((d) => d in DOCUMENTOS_PERSONA))],
  };
  // Si el puesto pide documentación, quien lo tenga tiene que poder rellenarla (si no, «falta» para siempre).
  if (datos.documentos.length && !datos.permisos.includes("documentos.propios")) datos.permisos.push("documentos.propios");
  return datos;
}

export async function crearPerfil(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  const datos = leerPerfil(form);
  if (!datos.nombre) return volver("Ponle nombre al perfil.", "error");
  const { error } = await supabase.from("perfiles").insert(datos);
  if (error) return volver(error.code === "23505" ? "Ya hay un perfil con ese nombre." : "No se ha podido crear el perfil.", "error");
  revalidatePath("/admin");
  volver(`Perfil «${datos.nombre}» creado.`);
}

export async function guardarPerfil(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  const datos = leerPerfil(form);
  if (!datos.nombre) return volver("Ponle nombre al perfil.", "error");
  const { error } = await supabase.from("perfiles").update(datos).eq("id", Number(form.get("id")));
  if (error) return volver(error.code === "23505" ? "Ya hay un perfil con ese nombre." : "No se ha podido guardar el perfil.", "error");
  revalidatePath("/admin");
  volver(`Perfil «${datos.nombre}» guardado. Los cambios valen ya para todas las personas que lo tienen.`);
}

export async function borrarPerfil(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  if (form.get("confirmar") !== "on") return volver("Marca la casilla para confirmar que quieres borrar el perfil.", "error");
  const { error } = await supabase.from("perfiles").delete().eq("id", Number(form.get("id")));
  if (error) return volver("No se ha podido borrar el perfil.", "error");
  revalidatePath("/admin");
  volver("Perfil borrado. Las personas que lo tenían lo han perdido.");
}

// ------------------------------------------------------------------ centros y camiones

export async function crearCentro(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  const nombre = String(form.get("nombre") ?? "").trim();
  if (!nombre) return volver("Falta el nombre del centro.", "error");
  const { error } = await supabase.from("centros").insert({ nombre });
  if (error) return volver(error.code === "23505" ? "Ese centro ya existe." : "No se ha podido crear el centro.", "error");
  revalidatePath("/admin");
  volver(`Centro «${nombre}» creado.`);
}

export async function crearVehiculo(form: FormData) {
  const { supabase } = await exigir("vehiculos.gestionar");
  const matricula = String(form.get("matricula") ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const modelo = String(form.get("modelo") ?? "").trim() || null;
  const centro_id = numero(form.get("centro"));
  if (!/^[A-Z0-9 -]{4,12}$/.test(matricula)) return volver("Revisa la matrícula.", "error");
  const { error } = await supabase.from("vehiculos").insert({ matricula, modelo, centro_id });
  if (error) return volver(error.code === "23505" ? "Esa matrícula ya existe." : "No se ha podido añadir el camión.", "error");
  revalidatePath("/admin");
  volver(`Camión ${matricula} añadido.`);
}

export async function cambiarVehiculo(form: FormData) {
  const { supabase } = await exigir("vehiculos.gestionar");
  const { error } = await supabase.from("vehiculos").update({ activo: form.get("activo") === "on" }).eq("id", Number(form.get("id")));
  if (error) return volver("No se ha podido guardar.", "error");
  revalidatePath("/admin");
  volver("Camión actualizado.");
}
