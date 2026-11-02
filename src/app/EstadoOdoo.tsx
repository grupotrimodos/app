import { ESTADO_ODOO } from "@/lib/jornada";

export default function EstadoOdoo({ estado, error }: { estado: string; error?: string | null }) {
  const texto = ESTADO_ODOO[estado] ?? estado;
  if (!texto) return null;
  const clase = estado === "enviado" ? "ok" : estado === "error" || estado === "sin_empleado" ? "mal" : "";
  return <span className={`etiqueta ${clase}`} title={error ?? undefined}>{texto}</span>;
}
