/** Catálogo de Seguridad: tipos de documento, de equipo y de incidencia, y cómo se calcula si algo está al día. */
import { hoyISO } from "./jornada";

/** Documentos de una persona. Qué pide cada puesto lo marca el administrador en su perfil (perfiles.documentos). */
export const DOCUMENTOS_PERSONA: Record<string, string> = {
  carnet_conducir: "Carnet de conducir",
  cap: "CAP (cualificación del conductor)",
  tarjeta_tacografo: "Tarjeta de tacógrafo",
  reconocimiento_medico: "Reconocimiento médico",
  formacion_carretillas: "Formación de carretillero",
  formacion_prl: "Formación en prevención de riesgos",
};

/** Los que no caducan (una formación): basta con apuntar que se tiene; los demás exigen fecha de caducidad. */
export const SIN_CADUCIDAD = new Set(["formacion_carretillas", "formacion_prl"]);

/** Documentos de cada vehículo: se piden a todos los camiones activos. */
export const DOCUMENTOS_VEHICULO: Record<string, string> = {
  itv: "ITV",
  seguro: "Seguro",
  tacografo: "Revisión del tacógrafo",
};

export const TIPOS_EQUIPO: Record<string, string> = {
  carretilla: "Carretilla elevadora", traspaleta: "Traspaleta", apilador: "Apilador", otro: "Otro equipo",
};
export const TIPOS_REVISION: Record<string, string> = {
  revision: "Revisión periódica", mantenimiento: "Mantenimiento", averia: "Avería", reparacion: "Reparación",
};
export const RESULTADO_REVISION: Record<string, string> = {
  correcto: "Correcto", con_defectos: "Con defectos", fuera_de_servicio: "Fuera de servicio",
};
export const TIPOS_INCIDENCIA: Record<string, string> = {
  accidente: "Accidente", incidente: "Incidente (sin daños)", averia: "Avería", otro: "Otro",
};
export const GRAVEDAD: Record<string, string> = { leve: "Leve", grave: "Grave", muy_grave: "Muy grave" };
export const ESTADO_INCIDENCIA: Record<string, string> = { abierta: "Abierta", en_curso: "En curso", cerrada: "Cerrada" };

/** Con cuántos días de antelación se avisa de que algo va a caducar. */
export const DIAS_AVISO = 30;

export type Caducidad = "falta" | "caducado" | "pronto" | "al_dia";
export const NOMBRE_CADUCIDAD: Record<Caducidad, string> = {
  falta: "Falta", caducado: "Caducado", pronto: "Caduca pronto", al_dia: "Al día",
};
/** Clase de la etiqueta (globals.css): rojo lo que hay que arreglar ya, amarillo lo que caduca pronto. */
export const CLASE_CADUCIDAD: Record<Caducidad, string> = { falta: "mal", caducado: "mal", pronto: "pronto", al_dia: "ok" };

/** «AAAA-MM-DD» sumando días (en calendario, sin horas). */
export function sumarDias(dia: string, dias: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Estado de una fecha de caducidad. Sin fecha cuenta como «falta»: no se sabe si está en regla. */
export function caducidad(caduca: string | null | undefined, hoy = hoyISO()): Caducidad {
  if (!caduca) return "falta";
  if (caduca < hoy) return "caducado";
  return caduca <= sumarDias(hoy, DIAS_AVISO) ? "pronto" : "al_dia";
}

/** Una fecha «AAAA-MM-DD» para leer: «12 nov 2026». */
export const fechaLarga = (dia: string) =>
  new Date(`${dia}T12:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Fecha válida de un formulario (<input type="date">) o null. */
export function leerFecha(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? null : s;
}

export type Documento = { id: number; usuario_id: string | null; vehiculo_id: number | null; tipo: string; numero: string | null; caduca: string | null };

/** Un documento apuntado sin fecha es uno que no caduca (p. ej. una formación); si no está apuntado, falta. */
export const estadoDocumento = (doc: Pick<Documento, "caduca"> | null | undefined, hoy = hoyISO()): Caducidad =>
  !doc ? "falta" : !doc.caduca ? "al_dia" : caducidad(doc.caduca, hoy);

/** Lo que pide el puesto y cómo está: un elemento por documento obligatorio (los que faltan, incluidos). */
export function situacionDocumentos(obligatorios: string[], tiene: Documento[], hoy = hoyISO()) {
  const porTipo = new Map(tiene.map((d) => [d.tipo, d]));
  return obligatorios.map((tipo) => {
    const doc = porTipo.get(tipo) ?? null;
    return { tipo, nombre: DOCUMENTOS_PERSONA[tipo] ?? tipo, doc, estado: estadoDocumento(doc, hoy) };
  });
}
