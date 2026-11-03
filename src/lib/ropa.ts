/** Catálogo de ropa de trabajo y EPIs que se puede pedir, con sus tallas. Para añadir una prenda, una línea aquí. */
const ROPA = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];
const PANTALON = ["36", "38", "40", "42", "44", "46", "48", "50", "52", "54", "56", "58", "60"];
const CALZADO = ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48"];
const UNICA = ["Única"];

export const PRENDAS: Record<string, { nombre: string; tallas: string[] }> = {
  camiseta: { nombre: "Camiseta", tallas: ROPA },
  polo: { nombre: "Polo", tallas: ROPA },
  pantalon: { nombre: "Pantalón de trabajo", tallas: PANTALON },
  forro: { nombre: "Forro polar o sudadera", tallas: ROPA },
  chaqueta: { nombre: "Chaqueta de abrigo", tallas: ROPA },
  chaleco: { nombre: "Chaleco reflectante", tallas: ROPA },
  impermeable: { nombre: "Impermeable", tallas: ROPA },
  calzado: { nombre: "Calzado de seguridad", tallas: CALZADO },
  guantes: { nombre: "Guantes de trabajo", tallas: ["7", "8", "9", "10", "11"] },
  gafas: { nombre: "Gafas de protección", tallas: UNICA },
  auditivos: { nombre: "Protectores auditivos", tallas: UNICA },
};

/** Cuántas unidades de una misma prenda se pueden pedir de una vez. */
export const MAX_UNIDADES = 5;

export const MOTIVOS_ROPA: Record<string, string> = {
  primera_entrega: "Primera entrega", desgaste: "Desgaste o rotura", talla: "Cambio de talla", perdida: "Pérdida", otro: "Otro motivo",
};

export const ESTADO_ROPA: Record<string, string> = {
  pendiente: "Pendiente de aprobar", aprobada: "Aprobada, en preparación", entregada: "Entregada", rechazada: "Rechazada", anulada: "Anulada",
};
/** Clase de la etiqueta (globals.css). */
export const CLASE_ROPA: Record<string, string> = { pendiente: "pronto", aprobada: "", entregada: "ok", rechazada: "mal", anulada: "" };

export type LineaRopa = { prenda: string; talla: string; cantidad: number };

/** «2 × Calzado de seguridad (42)». */
export const textoLinea = (l: LineaRopa) => `${l.cantidad} × ${PRENDAS[l.prenda]?.nombre ?? l.prenda} (${l.talla})`;

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
