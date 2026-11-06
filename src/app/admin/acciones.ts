"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
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

/** Vuelve a la misma pestaña de Administración, con sus filtros, y el mensaje. */
async function volver(msg: string, tipo: "ok" | "error" = "ok"): Promise<never> {
  let destino = "/admin";
  try {
    const u = new URL((await headers()).get("referer") ?? "");
    if (u.pathname === "/admin") {
      u.searchParams.delete("ok");
      u.searchParams.delete("error");
      destino = `/admin${u.search}`;
    }
  } catch { /* sin «referer»: a la portada de Administración */ }
  redirect(`${destino}${destino.includes("?") ? "&" : "?"}${tipo}=${encodeURIComponent(msg)}`);
}

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
  return volver(`Usuario ${codigo} creado. Dale su código y su PIN.`);
}

export async function guardarUsuario(form: FormData) {
  const { supabase, uid, perfil: yo } = await exigir("admin.usuarios");
  const id = String(form.get("id"));
  // El id de empleado de Odoo: vacío (se busca solo) o un número. Otra cosa no se guarda: borraría el enlace con Odoo.
  const idOdoo = String(form.get("odoo_employee_id") ?? "").trim();
  if (idOdoo && !/^\d{1,9}$/.test(idOdoo)) return volver("El id de empleado de Odoo tiene que ser un número (o dejarlo vacío).", "error");
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
  return volver("Cambios guardados.");
}

/** Un puesto o un responsable trabaja sobre un centro; sin él, nadie recibe lo que pide esa persona (o no tiene a nadie
 *  a su cargo). Solo los perfiles marcados «todos los centros» (p. ej. Seguridad) van sin centro. */
async function exigirCentro(supabase: Awaited<ReturnType<typeof exigir>>["supabase"], perfil: number, centro: number | null) {
  if (centro) return null;
  const { data } = await supabase.from("perfiles").select("nombre,todos_los_centros").eq("id", perfil)
    .maybeSingle<{ nombre: string; todos_los_centros: boolean }>();
  return data?.todos_los_centros ? null : `Elige el centro: el perfil «${data?.nombre ?? ""}» trabaja sobre un centro.`;
}

/** Activa de una vez a varias personas recién llegadas (p. ej. chóferes que han entrado con Google) con el mismo
 *  puesto y centro. */
export async function configurarVarios(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  const ids = [...new Set(form.getAll("ids").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)))];
  const perfil = numero(form.get("perfil"));
  const centro = numero(form.get("centro"));
  if (!ids.length) return volver("Marca a las personas que quieres activar.", "error");
  if (!perfil) return volver("Elige su puesto.", "error");
  const falta = await exigirCentro(supabase, perfil, centro);
  if (falta) return volver(falta, "error");
  const { error } = await supabase.from("usuario_perfil")
    .upsert(ids.map((usuario_id) => ({ usuario_id, perfil_id: perfil, centro_id: centro })), { onConflict: "usuario_id,perfil_id,centro_id", ignoreDuplicates: true });
  if (error) return volver("No se ha podido asignar el puesto.", "error");
  const { error: e2 } = await supabase.from("usuarios").update({ activo: true }).in("id", ids);
  revalidatePath("/admin");
  revalidatePath("/");
  if (e2) return volver("Puesto asignado, pero no se han podido activar. Actívalas en su ficha.", "error");
  return volver(`${ids.length} ${ids.length === 1 ? "persona activada" : "personas activadas"}: ya ven lo de su puesto.`);
}

/** Cambia el puesto (Administrador, Oficina, Chófer, Operario…) de una persona: cada uno tiene uno. Los complementos
 *  (Responsable, Seguridad) se mantienen. */
export async function cambiarPuesto(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  const id = String(form.get("id"));
  const perfil = numero(form.get("perfil"));
  const centro = numero(form.get("centro"));
  if (!perfil) return volver("Elige su puesto.", "error");
  const falta = await exigirCentro(supabase, perfil, centro);
  if (falta) return volver(falta, "error");
  const { data: actuales } = await supabase.from("usuario_perfil").select("id,perfil_id,centro_id,perfiles(pantalla)").eq("usuario_id", id)
    .returns<{ id: number; perfil_id: number; centro_id: number | null; perfiles: { pantalla: string | null } | null }[]>();
  const puestos = (actuales ?? []).filter((a) => a.perfiles?.pantalla);
  if (puestos.length === 1 && puestos[0].perfil_id === perfil && puestos[0].centro_id === centro) return volver("Ya tenía ese puesto en ese centro.");
  const { error } = await supabase.from("usuario_perfil").insert({ usuario_id: id, perfil_id: perfil, centro_id: centro });
  if (error && error.code !== "23505") return volver("No se ha podido cambiar el puesto.", "error");
  const quitar = puestos.filter((a) => !(a.perfil_id === perfil && a.centro_id === centro)).map((a) => a.id);
  if (quitar.length) await supabase.from("usuario_perfil").delete().in("id", quitar);
  revalidatePath("/admin");
  return volver("Puesto cambiado. Lo que ve cambia en cuanto vuelva a abrir la app.");
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
  return volver("Perfil asignado.");
}

export async function quitarPerfil(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  const { data, error } = await supabase.from("usuario_perfil").delete().eq("id", Number(form.get("asignacion"))).select("id");
  if (error || !data?.length) return volver("No se ha podido quitar el perfil.", "error");
  revalidatePath("/admin");
  return volver("Perfil quitado.");
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
  return volver(`PIN de ${u.codigo} cambiado.`);
}

// ------------------------------------------------------------------ perfiles

const PANTALLAS = ["direccion", "oficina", "campo"];

function leerPerfil(form: FormData) {
  const pantalla = String(form.get("pantalla") ?? "");
  const datos: { nombre: string; descripcion: string | null; permisos: string[]; todos_los_centros: boolean; documentos: string[]; pantalla?: string | null } = {
    nombre: String(form.get("nombre") ?? "").trim(),
    descripcion: String(form.get("descripcion") ?? "").trim() || null,
    permisos: [...new Set(form.getAll("permisos").map(String).filter(esPermiso))],
    todos_los_centros: form.get("todos_los_centros") === "on",
    documentos: [...new Set(form.getAll("documentos").map(String).filter((d) => d in DOCUMENTOS_PERSONA))],
  };
  // La pantalla solo se cambia en los perfiles que no son de los cuatro básicos (en esos, el campo no se envía).
  if (form.has("pantalla")) datos.pantalla = PANTALLAS.includes(pantalla) ? pantalla : null;
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
  return volver(`Perfil «${datos.nombre}» creado.`);
}

export async function guardarPerfil(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  const datos = leerPerfil(form);
  if (!datos.nombre) return volver("Ponle nombre al perfil.", "error");
  const { error } = await supabase.from("perfiles").update(datos).eq("id", Number(form.get("id")));
  if (error) return volver(error.code === "23505" ? "Ya hay un perfil con ese nombre." : "No se ha podido guardar el perfil.", "error");
  revalidatePath("/admin");
  return volver(`Perfil «${datos.nombre}» guardado. Los cambios valen ya para todas las personas que lo tienen.`);
}

export async function borrarPerfil(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  if (form.get("confirmar") !== "on") return volver("Marca la casilla para confirmar que quieres borrar el perfil.", "error");
  const { error } = await supabase.from("perfiles").delete().eq("id", Number(form.get("id")));
  if (error) return volver(error.message.includes("cuatro básicos") ? "Ese perfil es uno de los cuatro básicos y no se puede borrar."
    : "No se ha podido borrar el perfil.", "error");
  revalidatePath("/admin");
  return volver("Perfil borrado. Las personas que lo tenían lo han perdido.");
}

// ------------------------------------------------------------------ centros y camiones

export async function crearCentro(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  const nombre = String(form.get("nombre") ?? "").trim();
  if (!nombre) return volver("Falta el nombre del centro.", "error");
  const { error } = await supabase.from("centros").insert({ nombre });
  if (error) return volver(error.code === "23505" ? "Ese centro ya existe." : "No se ha podido crear el centro.", "error");
  revalidatePath("/admin");
  return volver(`Centro «${nombre}» creado.`);
}

/** Cuenta o etiqueta analítica de Odoo de un centro: con ellas el cuadro de mando separa ingresos, gastos y margen.
 *  El valor llega como «cuenta:123:Nombre» o «etiqueta:45:Nombre» (de la lista que da Odoo). */
export async function asignarAnalitica(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  const centro = numero(form.get("centro"));
  const m = /^(cuenta|etiqueta):(\d{1,9}):(.{1,200})$/s.exec(String(form.get("analitica") ?? ""));
  if (!centro || !m) return volver("Elige la cuenta o etiqueta analítica.", "error");
  const { error } = await supabase.from("centro_analitica").insert({ centro_id: centro, tipo: m[1], odoo_id: Number(m[2]), nombre: m[3].trim() });
  if (error) return volver(error.code === "23505" ? "Esa cuenta o etiqueta ya es de otro centro: quítasela antes." : "No se ha podido guardar.", "error");
  revalidatePath("/admin");
  return volver(`«${m[3].trim()}» asignada al centro.`);
}

export async function quitarAnalitica(form: FormData) {
  const { supabase } = await exigir("admin.usuarios");
  const { error } = await supabase.from("centro_analitica").delete().eq("id", Number(form.get("id")));
  if (error) return volver("No se ha podido quitar.", "error");
  revalidatePath("/admin");
  return volver("Quitada.");
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
  return volver(`Camión ${matricula} añadido.`);
}

export async function cambiarVehiculo(form: FormData) {
  const { supabase } = await exigir("vehiculos.gestionar");
  const { error } = await supabase.from("vehiculos").update({ activo: form.get("activo") === "on" }).eq("id", Number(form.get("id")));
  if (error) return volver("No se ha podido guardar.", "error");
  revalidatePath("/admin");
  return volver("Camión actualizado.");
}
