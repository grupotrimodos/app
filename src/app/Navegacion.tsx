"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icono, { ICONOS_AREA } from "./Icono";

type Enlace = { id: string; nombre: string; ruta: string };
const nombres: Record<string, string> = { flota: "Centro de flota", ausencias: "Mis ausencias", deca: "Órdenes de transporte" };
const orden: Record<string, number> = {
  direccion: 0, flota: 1, chofer: 2, deca: 3, fichaje: 4, ausencias: 5, ropa: 6, documentos: 7, incidencias: 8, equipo: 9, seguridad: 10, admin: 11,
};

export default function Navegacion({ areas, inicio = "Inicio" }: { areas: Enlace[]; inicio?: string }) {
  const ruta = usePathname();
  const enlaces = [{ id: "inicio", nombre: inicio, ruta: "/" }, ...[...areas].sort((a, b) => (orden[a.id] ?? 9) - (orden[b.id] ?? 9))];
  return <nav className="shell-nav" aria-label="Navegación principal">
    {enlaces.map((a) => {
      const activo = a.ruta === "/" ? ruta === "/" : ruta === a.ruta || ruta.startsWith(a.ruta.replace(/\/$/, "") + "/");
      const icono = a.id === "inicio" && inicio !== "Inicio" ? "actividad" : ICONOS_AREA[a.id] ?? "inicio";
      const contenido = <><Icono nombre={icono} size={21} /><span>{nombres[a.id] ?? a.nombre}</span></>;
      const props = { className: `shell-nav-link${activo ? " activo" : ""}`, "aria-current": activo ? "page" as const : undefined };
      // DECA es una PWA independiente y necesita una navegación completa.
      return a.id === "deca" ? <a key={a.id} href={a.ruta} {...props}>{contenido}</a>
        : <Link key={a.id} href={a.ruta} {...props}>{contenido}</Link>;
    })}
  </nav>;
}

/** En la app del móvil (chóferes y operarios) no hay menú: fuera del inicio, un botón grande para volver. */
export function VolverAlInicio() {
  const ruta = usePathname();
  if (ruta === "/") return <span className="campo-hueco" />;
  return <Link className="campo-volver" href="/"><Icono nombre="flecha" size={18} /><span>Inicio</span></Link>;
}
