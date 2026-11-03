import { ESTADO_ODOO } from "@/lib/jornada";

/** Estado del envío a Odoo. Con `detalle`, el motivo del error se ve escrito (en el móvil no hay «pasar el ratón»). */
export default function EstadoOdoo({ estado, error, detalle = false }: { estado: string; error?: string | null; detalle?: boolean }) {
  const texto = ESTADO_ODOO[estado] ?? estado;
  if (!texto) return null;
  const clase = estado === "enviado" ? "ok" : estado === "error" || estado === "sin_empleado" ? "mal" : "";
  const etiqueta = <span className={`etiqueta ${clase}`} title={error ?? undefined}>{texto}</span>;
  return detalle && error ? <>{etiqueta}<span className="hint odoo-motivo">{error}</span></> : etiqueta;
}
