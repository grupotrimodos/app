import { cache } from "react";
import { documentosDe } from "@/lib/documentos";
import { fecha, NOMBRE_AUSENCIA } from "@/lib/jornada";
import { tallasQueFaltan, temporadaActual, type LineaKit, type Tallas } from "@/lib/ropa";
import { DIAS_AVISO } from "@/lib/seguridad";
import { usuarioActual } from "@/lib/usuario";

/**
 * Lo que le llega a cada persona: las tareas que tiene que resolver (según sus permisos; la base de datos decide qué
 * filas ve) y las respuestas a lo que ha pedido en los últimos 7 días. Una sola fuente para la campana de la cabecera,
 * la página «Pendientes» y las cifras del inicio, para que siempre digan lo mismo.
 */
export type Tarea = { id: string; titulo: string; cantidad: number | null; detalle: string; href: string; icono: string };
export type Novedad = { cuando: string; texto: string; href: string; bien: boolean | null };

const cuenta = (r: { count: number | null; error: unknown } | null) => (!r || r.error ? null : r.count ?? 0);

export const misPendientes = cache(async function misPendientes() {
  const { supabase, uid, perfil, puede, esDeSuPuesto } = await usuarioActual();
  if (!perfil?.activo) return { tareas: [] as Tarea[], novedades: [] as Novedad[], total: 0 };
  const hace7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const seguridad = puede("seguridad.gestionar");
  const caducidades = seguridad || puede("vehiculos.gestionar");
  const cabeza = { count: "exact" as const, head: true };
  const temporada = temporadaActual();
  const conRopa = esDeSuPuesto("ropa.pedir");
  const [aus, ropaP, ropaA, ropaT, gente, inc, cad, odooF, odooA, docs, miDot, misTallas, misAus, miRopa, misInc] = await Promise.all([
    puede("ausencias.aprobar") ? supabase.from("ausencias").select("id", cabeza).eq("estado", "pendiente").neq("usuario_id", uid) : null,
    puede("ropa.gestionar") ? supabase.from("solicitudes_ropa").select("id", cabeza).eq("estado", "pendiente").neq("usuario_id", uid) : null,
    puede("ropa.gestionar") ? supabase.from("solicitudes_ropa").select("id", cabeza).eq("estado", "aprobada").neq("usuario_id", uid) : null,
    puede("ropa.gestionar") ? supabase.from("ropa_dotaciones").select("id", cabeza).eq("temporada", temporada).eq("estado", "por_entregar")
      .neq("usuario_id", uid) : null,
    puede("admin.usuarios") ? supabase.from("usuarios").select("id,es_admin,activo,usuario_perfil(id)") : null,
    seguridad ? supabase.from("incidencias").select("id", cabeza).neq("estado", "cerrada") : null,
    caducidades ? supabase.rpc("resumen_caducidades", { dias: DIAS_AVISO, solo_vehiculos: !seguridad }) : null,
    puede("admin.sincronizacion") ? supabase.from("fichajes").select("id", cabeza).in("odoo_estado", ["error", "sin_empleado"]) : null,
    puede("admin.sincronizacion") ? supabase.from("ausencias").select("id", cabeza).in("odoo_estado", ["error", "sin_empleado"]) : null,
    esDeSuPuesto("documentos.propios") ? documentosDe(supabase, uid) : null,
    conRopa ? supabase.from("ropa_dotaciones").select("prendas,estado").eq("usuario_id", uid).eq("temporada", temporada)
      .maybeSingle<{ prendas: LineaKit[]; estado: string }>() : null,
    conRopa ? supabase.from("tallas_ropa").select("tallas").eq("usuario_id", uid).maybeSingle<{ tallas: Tallas }>() : null,
    supabase.from("ausencias").select("id,tipo,desde,hasta,estado,resuelto_en").eq("usuario_id", uid).gte("resuelto_en", hace7),
    supabase.from("solicitudes_ropa").select("id,estado,resuelto_en,entregado_en").eq("usuario_id", uid)
      .or(`resuelto_en.gte.${hace7},entregado_en.gte.${hace7}`),
    supabase.from("incidencias").select("id,tipo,cerrada_en").eq("reportado_por", uid).gte("cerrada_en", hace7),
  ]);

  const tareas: Tarea[] = [];
  if (aus) tareas.push({ id: "ausencias", titulo: "Vacaciones por aprobar", cantidad: cuenta(aus), href: "/equipo", icono: "calendario",
    detalle: "De las personas que tienes a tu cargo" });
  if (ropaP) {
    const n = cuenta(ropaP), m = cuenta(ropaA), t = cuenta(ropaT);
    tareas.push({ id: "ropa-temporada", titulo: "Ropa de temporada por entregar", cantidad: t, href: "/ropa?ver=temporada", icono: "ropa",
      detalle: "Dos mudas por persona: márcalas como entregadas al darlas" });
    tareas.push({ id: "ropa", titulo: "Cambios de ropa por aprobar", cantidad: n, href: "/ropa?ver=cambios", icono: "ropa",
      detalle: "Roturas, tallas o pérdidas de las personas de tus centros" });
    if (m) tareas.push({ id: "ropa-entregar", titulo: "Cambios de ropa por entregar", cantidad: m, href: "/ropa?ver=cambios", icono: "ropa",
      detalle: "Aprobados: márcalos como entregados al darlos" });
  }
  const dot = miDot?.data;
  if (dot?.estado === "entregada") {
    tareas.push({ id: "mi-ropa", titulo: "Confirma tu ropa", cantidad: 1, href: "/ropa", icono: "ropa",
      detalle: "Te la han entregado: confirma que la tienes" });
  } else if (dot?.estado === "por_entregar" && tallasQueFaltan(dot.prendas, misTallas?.data?.tallas).length) {
    tareas.push({ id: "mi-ropa", titulo: "Apunta tus tallas", cantidad: 1, href: "/ropa", icono: "ropa",
      detalle: "Para que te preparen la ropa de esta temporada" });
  }
  if (gente) {
    // Quien no tiene ningún perfil (recién llegado con Microsoft, o creado sin perfil) no ve nada hasta que se configure.
    const filas = (gente.data ?? []) as { es_admin: boolean; activo: boolean; usuario_perfil: { id: number }[] }[];
    const n = gente.error ? null : filas.filter((u) => !u.es_admin && u.usuario_perfil.length === 0).length;
    tareas.push({ id: "configurar", titulo: "Personas por configurar", cantidad: n, href: "/admin?ver=personas&estado=configurar", icono: "equipo",
      detalle: n ? "Sin perfil: actívalas y dales puesto y centro" : "Todo el mundo tiene su perfil" });
  }
  if (cad) {
    const r = ((cad.data ?? []) as { caducados: number; pronto: number; faltan: number }[])[0];
    const n = cad.error || !r ? null : r.caducados + r.faltan;
    tareas.push({ id: "caducidades", titulo: seguridad ? "Caducidades" : "ITV y seguros", cantidad: n,
      href: seguridad ? "/seguridad" : "/seguridad?ver=vehiculos", icono: "documento",
      detalle: !r ? "No se ha podido calcular" : `${r.caducados} caducados · ${r.faltan} sin apuntar · ${r.pronto} caducan en ${DIAS_AVISO} días` });
  }
  if (inc) tareas.push({ id: "incidencias", titulo: "Incidencias abiertas", cantidad: cuenta(inc), href: "/seguridad?ver=incidencias",
    icono: "escudo", detalle: "Pendientes de cerrar" });
  if (odooF) {
    const f = cuenta(odooF), a = cuenta(odooA);
    tareas.push({ id: "odoo", titulo: "Envíos a Odoo con error", cantidad: f === null || a === null ? null : f + a,
      href: "/admin/sincronizacion", icono: "actualizar", detalle: "Fichajes o ausencias que no han llegado a Odoo" });
  }
  if (docs) {
    const n = docs.situacion.filter((s) => s.estado !== "al_dia").length;
    tareas.push({ id: "documentos", titulo: "Tu documentación", cantidad: n, href: "/documentos", icono: "documento",
      detalle: n ? "Te falta algo o caduca pronto" : "Todo al día" });
  }

  type A = { id: number; tipo: string; desde: string; hasta: string; estado: string; resuelto_en: string };
  type R = { id: number; estado: string; resuelto_en: string | null; entregado_en: string | null };
  const novedades: Novedad[] = [
    ...((misAus.data ?? []) as A[]).filter((a) => a.estado === "aprobada" || a.estado === "rechazada").map((a) => ({
      cuando: a.resuelto_en, href: "/ausencias", bien: a.estado === "aprobada",
      texto: `${a.estado === "aprobada" ? "Aprobadas" : "Rechazadas"} tus ${(NOMBRE_AUSENCIA[a.tipo] ?? "ausencias").toLowerCase()} del ${fecha(a.desde + "T12:00:00Z")}`,
    })),
    ...((miRopa.data ?? []) as R[]).filter((r) => r.estado !== "anulada" && r.estado !== "pendiente").map((r) => ({
      cuando: (r.entregado_en ?? r.resuelto_en)!, href: "/ropa", bien: r.estado === "rechazada" ? false : true,
      texto: { aprobada: "Aprobado tu pedido de ropa: te avisarán al entregarlo", entregada: "Entregado tu pedido de ropa",
        rechazada: "Rechazado tu pedido de ropa" }[r.estado] ?? "Tu pedido de ropa ha cambiado",
    })),
    ...((misInc.data ?? []) as { id: number; cerrada_en: string }[]).map((i) => ({
      cuando: i.cerrada_en, href: "/incidencias", bien: null, texto: "Seguridad ha cerrado una incidencia que avisaste",
    })),
  ].sort((a, b) => b.cuando.localeCompare(a.cuando));

  const total = tareas.reduce((s, t) => s + (t.cantidad ?? 0), 0) + novedades.length;
  return { tareas, novedades, total };
});
