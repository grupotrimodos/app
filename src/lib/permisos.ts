import catalogo from "./permisos.json";

/** Catálogo de áreas y permisos (src/lib/permisos.json): única fuente para el menú, el editor de perfiles y las comprobaciones. */
export type Permiso = { id: string; nombre: string; de_puesto?: boolean };
export type Area = { id: string; nombre: string; ruta: string; descripcion: string; permisos: Permiso[] };

export const AREAS: Area[] = catalogo.areas;
export const TODOS_LOS_PERMISOS = AREAS.flatMap((a) => a.permisos.map((p) => p.id));
const VALIDOS = new Set(TODOS_LOS_PERMISOS);

export const esPermiso = (p: string) => VALIDOS.has(p);
/** Permisos para el trabajo propio (fichar, su camión, la flota…): solo cuentan para el menú si vienen de sus perfiles. */
export const DE_PUESTO = new Set(AREAS.flatMap((a) => a.permisos.filter((p) => p.de_puesto).map((p) => p.id)));

/** Permisos de un área (para saber si alguien la ve). */
export const permisosDe = (area: string) => AREAS.find((a) => a.id === area)?.permisos.map((p) => p.id) ?? [];

/** Pantalla de cada perfil: la de dirección, la de oficina (gestión) o la del móvil (chóferes y operarios). */
export type Pantalla = "direccion" | "oficina" | "campo";
export const NOMBRE_PANTALLA: Record<Pantalla, string> = {
  direccion: "Dirección: cuadro de mando de toda la empresa",
  oficina: "Oficina: espacio de gestión con menú",
  campo: "Chóferes y operarios: una sola pantalla en el móvil",
};
/** Si alguien tiene varios perfiles, manda la pantalla de más alcance. */
export const RANGO_PANTALLA: Record<Pantalla, number> = { campo: 1, oficina: 2, direccion: 3 };
