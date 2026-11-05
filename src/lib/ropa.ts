/** Catálogo de ropa de trabajo y EPIs, con sus tallas. Para añadir una prenda, una línea aquí. */
const ROPA = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];
const PANTALON = ["36", "38", "40", "42", "44", "46", "48", "50", "52", "54", "56", "58", "60"];
const CALZADO = ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48"];
const GUANTES = ["7", "8", "9", "10", "11"];
const UNICA = ["Única"];

/** Cada persona apunta una talla por grupo (no una por prenda): la de arriba vale para camisetas, polos y chaquetas. */
export const GRUPOS_TALLA: Record<string, { nombre: string; tallas: string[] }> = {
  arriba: { nombre: "Camisetas, polos, sudaderas y chaquetas", tallas: ROPA },
  pantalon: { nombre: "Pantalón", tallas: PANTALON },
  calzado: { nombre: "Calzado", tallas: CALZADO },
  guantes: { nombre: "Guantes", tallas: GUANTES },
};

export const PRENDAS: Record<string, { nombre: string; tallas: string[]; grupo?: keyof typeof GRUPOS_TALLA }> = {
  camiseta: { nombre: "Camiseta", tallas: ROPA, grupo: "arriba" },
  polo: { nombre: "Polo", tallas: ROPA, grupo: "arriba" },
  pantalon: { nombre: "Pantalón de trabajo", tallas: PANTALON, grupo: "pantalon" },
  forro: { nombre: "Forro polar o sudadera", tallas: ROPA, grupo: "arriba" },
  chaqueta: { nombre: "Chaqueta de abrigo", tallas: ROPA, grupo: "arriba" },
  chaleco: { nombre: "Chaleco reflectante", tallas: ROPA, grupo: "arriba" },
  impermeable: { nombre: "Impermeable", tallas: ROPA, grupo: "arriba" },
  calzado: { nombre: "Calzado de seguridad", tallas: CALZADO, grupo: "calzado" },
  guantes: { nombre: "Guantes de trabajo", tallas: GUANTES, grupo: "guantes" },
  gafas: { nombre: "Gafas de protección", tallas: UNICA },
  auditivos: { nombre: "Protectores auditivos", tallas: UNICA },
};

/** Cuántas unidades de una misma prenda se pueden pedir de una vez. */
export const MAX_UNIDADES = 5;

/** Motivos de un cambio. «Primera entrega» ya no se pide: la ropa de temporada llega sola. */
export const MOTIVOS_ROPA: Record<string, string> = {
  primera_entrega: "Primera entrega", desgaste: "Desgaste o rotura", talla: "Cambio de talla", perdida: "Pérdida", otro: "Otro motivo",
};
export const MOTIVOS_CAMBIO = ["desgaste", "talla", "perdida", "otro"] as const;

export const ESTADO_ROPA: Record<string, string> = {
  pendiente: "Pendiente de aprobar", aprobada: "Aprobada, en preparación", entregada: "Entregada", rechazada: "Rechazada", anulada: "Anulada",
};
/** Clase de la etiqueta (globals.css). */
export const CLASE_ROPA: Record<string, string> = { pendiente: "pronto", aprobada: "", entregada: "ok", rechazada: "mal", anulada: "" };

export type LineaRopa = { prenda: string; talla: string; cantidad: number };
/** Línea de una muda o de una dotación: la talla sale de las tallas de la persona. */
export type LineaKit = { prenda: string; cantidad: number };
export type Tallas = Partial<Record<keyof typeof GRUPOS_TALLA, string>>;

/** «2 × Calzado de seguridad (42)». */
export const textoLinea = (l: LineaRopa) => `${l.cantidad} × ${PRENDAS[l.prenda]?.nombre ?? l.prenda} (${l.talla})`;

/** Talla de una prenda según las tallas de la persona (null si no la ha apuntado). */
export function tallaDe(prenda: string, tallas: Tallas | null | undefined): string | null {
  const p = PRENDAS[prenda];
  if (!p) return null;
  if (!p.grupo) return p.tallas[0];
  return tallas?.[p.grupo] ?? null;
}

/** «2 × Pantalón de trabajo (44)» o «… (falta la talla)». */
export const textoKit = (l: LineaKit, tallas?: Tallas | null) => {
  const nombre = PRENDAS[l.prenda]?.nombre ?? l.prenda;
  if (tallas === undefined) return `${l.cantidad} × ${nombre}`;
  const t = tallaDe(l.prenda, tallas);
  return `${l.cantidad} × ${nombre} (${t ?? "falta la talla"})`;
};

/** Grupos de talla que hacen falta para estas prendas, y los que la persona no ha apuntado. */
export const gruposDe = (prendas: LineaKit[]) => [...new Set(prendas.map((l) => PRENDAS[l.prenda]?.grupo).filter((g): g is string => !!g))];
export const tallasQueFaltan = (prendas: LineaKit[], tallas: Tallas | null | undefined) =>
  gruposDe(prendas).filter((g) => !tallas?.[g as keyof Tallas]);

/** «2026-invierno» → «Invierno 2026-27»; «2027-verano» → «Verano 2027». */
export function nombreTemporada(t: string) {
  const [anio, tipo] = t.split("-");
  return tipo === "verano" ? `Verano ${anio}` : `Invierno ${anio}-${String(Number(anio) + 1).slice(2)}`;
}

export const ESTADO_DOTACION: Record<string, string> = {
  por_entregar: "Por entregar", entregada: "Entregada · falta tu confirmación", recibida: "Recibida",
};
export const CLASE_DOTACION: Record<string, string> = { por_entregar: "pronto", entregada: "", recibida: "ok" };

/** Lee las tallas de un formulario (talla_<grupo>) y devuelve solo las válidas. */
export function leerTallas(form: FormData): Tallas {
  const tallas: Tallas = {};
  for (const [g, def] of Object.entries(GRUPOS_TALLA)) {
    const t = String(form.get(`talla_${g}`) ?? "");
    if (def.tallas.includes(t)) tallas[g as keyof Tallas] = t;
  }
  return tallas;
}

/** Lee las líneas del formulario (cantidad_<prenda>, talla_<prenda>) y devuelve las que tienen cantidad, o un error. */
export function leerLineas(form: FormData): LineaRopa[] | string {
  const lineas: LineaRopa[] = [];
  for (const [id, p] of Object.entries(PRENDAS)) {
    const cantidad = Number(form.get(`cantidad_${id}`) || 0);
    if (!cantidad) continue;
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_UNIDADES) return `Revisa cuántas «${p.nombre}» pides.`;
    const talla = p.tallas.length === 1 ? p.tallas[0] : String(form.get(`talla_${id}`) ?? "");
    if (!p.tallas.includes(talla)) return `Elige la talla de «${p.nombre}».`;
    lineas.push({ prenda: id, talla, cantidad });
  }
  return lineas.length ? lineas : "Elige al menos una prenda y cuántas necesitas.";
}

/** Lee una muda del formulario de composición (kit_<prenda> = unidades por muda, 0–3). */
export function leerKit(form: FormData): LineaKit[] {
  const kit: LineaKit[] = [];
  for (const id of Object.keys(PRENDAS)) {
    const n = Number(form.get(`kit_${id}`) || 0);
    if (Number.isInteger(n) && n >= 1 && n <= 3) kit.push({ prenda: id, cantidad: n });
  }
  return kit;
}

/** Temporada en curso, con la misma regla que la base de datos (public.temporada_ropa): verano de abril a septiembre. */
export function temporadaActual(d = new Date()) {
  const [y, m] = d.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" }).split("-").map(Number);
  return m >= 4 && m <= 9 ? `${y}-verano` : m >= 10 ? `${y}-invierno` : `${y - 1}-invierno`;
}
