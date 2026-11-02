import catalogo from "./permisos.json";

/** Catálogo de áreas y permisos (src/lib/permisos.json): única fuente para el inicio, el editor de perfiles y las comprobaciones. */
export type Area = { id: string; nombre: string; ruta: string; descripcion: string; permisos: { id: string; nombre: string }[] };

export const AREAS: Area[] = catalogo.areas;
export const TODOS_LOS_PERMISOS = AREAS.flatMap((a) => a.permisos.map((p) => p.id));
const VALIDOS = new Set(TODOS_LOS_PERMISOS);

export const esPermiso = (p: string) => VALIDOS.has(p);
export const NOMBRE_PERMISO = new Map(AREAS.flatMap((a) => a.permisos.map((p) => [p.id, p.nombre] as const)));

/** Permisos de un área (para saber si alguien la ve). */
export const permisosDe = (area: string) => AREAS.find((a) => a.id === area)?.permisos.map((p) => p.id) ?? [];
