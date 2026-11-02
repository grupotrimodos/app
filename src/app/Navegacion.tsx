"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icono, { ICONOS_AREA } from "./Icono";

type Enlace = { id: string; nombre: string; ruta: string };
const nombres: Record<string, string> = { flota: "Centro de flota", ausencias: "Mis ausencias", deca: "Órdenes de transporte" };
const orden: Record<string, number> = { flota: 1, chofer: 2, deca: 3, fichaje: 4, ausencias: 5, equipo: 6, admin: 7 };

export default function Navegacion({ areas }: { areas: Enlace[] }) {
  const ruta = usePathname();
  const enlaces = [{ id: "inicio", nombre: "Inicio", ruta: "/" }, ...[...areas].sort((a, b) => (orden[a.id] ?? 9) - (orden[b.id] ?? 9))];
  return <nav className="shell-nav" aria-label="Navegación principal">
    {enlaces.map((a) => {
      const activo = a.ruta === "/" ? ruta === "/" : ruta === a.ruta || ruta.startsWith(a.ruta.replace(/\/$/, "") + "/");
      const contenido = <><Icono nombre={ICONOS_AREA[a.id] ?? "inicio"} size={21} /><span>{nombres[a.id] ?? a.nombre}</span></>;
      const props = { className: `shell-nav-link${activo ? " activo" : ""}`, "aria-current": activo ? "page" as const : undefined };
      // DECA es una PWA independiente y necesita una navegación completa.
      return a.id === "deca" ? <a key={a.id} href={a.ruta} {...props}>{contenido}</a>
        : <Link key={a.id} href={a.ruta} {...props}>{contenido}</Link>;
    })}
  </nav>;
}
