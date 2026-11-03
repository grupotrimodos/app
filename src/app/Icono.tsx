import type { ReactNode } from "react";

const trazos: Record<string, ReactNode> = {
  inicio: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></>,
  flota: <><path d="M3 9V5h12v4M1 9h13v9H1zM14 12h4l4 4v2h-8M18 12v4h4" /><circle cx="5" cy="19" r="2" /><circle cx="18" cy="19" r="2" /></>,
  camion: <><path d="M2 5h12v13H2zM14 9h4l4 5v4h-8M17 9v5h5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="18" r="2.5" /></>,
  reloj: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  calendario: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M7 14h2M15 14h2M7 18h2" /></>,
  equipo: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" /></>,
  documento: <><path d="M13 3H5v18h14V9zM13 3v6h6M8 13h8M8 17h6" /></>,
  ajustes: <><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3h3l2 3h3l1-3 3-1 2-3-2-2 1-3-2-3h-3l-2-3z" /><circle cx="11.5" cy="12" r="3" /></>,
  flecha: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
  salir: <><path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4" /></>,
  actualizar: <><path d="M20 7v5h-5M4 17v-5h5M19 7a8 8 0 0 0-14-1M5 17a8 8 0 0 0 14 1" /></>,
  buscar: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  ubicacion: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  combustible: <><path d="M3 21V4h10v17M1 21h14M3 10h10M13 13h2a2 2 0 0 1 2 2v3a2 2 0 0 0 4 0V9l-4-4M18 6v4h3" /></>,
  actividad: <><path d="M2 12h5l3-8 4 16 3-8h5" /></>,
  escudo: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6" /></>,
  pausa: <><path d="M8 5v14M16 5v14" /></>,
  ruta: <><circle cx="5" cy="5" r="2" /><circle cx="19" cy="19" r="2" /><path d="M7 5h9a4 4 0 0 1 0 8H8a3 3 0 0 0 0 6h9" /></>,
  aviso: <><path d="m12 3 10 18H2zM12 9v5M12 17v.1" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  campana: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" /></>,
  ropa: <path d="M8.5 3 3 6l2 5 2.5-1V21h9V10l2.5 1 2-5-5.5-3a3.5 3.5 0 0 1-7 0Z" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
};

/** Iconos propios, ligeros y sin dependencias. El texto del control aporta su nombre accesible. */
export default function Icono({ nombre, size = 22, className }: { nombre: string; size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
    {trazos[nombre] ?? trazos.documento}
  </svg>;
}

export const ICONOS_AREA: Record<string, string> = {
  flota: "flota", fichaje: "reloj", chofer: "camion", ausencias: "calendario", equipo: "equipo", deca: "documento", admin: "ajustes",
  documentos: "documento", incidencias: "aviso", seguridad: "escudo", ropa: "ropa",
};
