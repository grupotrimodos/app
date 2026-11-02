/** Catálogo de módulos de la app. El identificador es el que se guarda en usuarios.modulos. */
export type Modulo = { id: string; nombre: string; descripcion: string; ruta: string };

export const MODULOS: Modulo[] = [
  {
    id: "fichaje",
    nombre: "Fichaje",
    descripcion: "Fichar la entrada, las pausas y la salida. Se anota en Odoo.",
    ruta: "/fichaje",
  },
  {
    id: "chofer",
    nombre: "Mi camión",
    descripcion: "Confirmar el camión de hoy (tarjeta del tacógrafo), ver tus horas y empezar o terminar la jornada.",
    ruta: "/chofer",
  },
  {
    id: "ausencias",
    nombre: "Vacaciones y ausencias",
    descripcion: "Pedir días y ver si están aprobados.",
    ruta: "/ausencias",
  },
  {
    id: "deca",
    nombre: "DECA · Orden de transporte",
    descripcion: "Corregir mercancía, bultos, euro palets y peso de la orden y descargar el PDF.",
    ruta: "/deca/",
  },
];

export const ROLES = ["responsable", "oficina", "chofer", "operario"] as const;
export type Rol = (typeof ROLES)[number];
export const NOMBRE_ROL: Record<Rol, string> = {
  responsable: "Responsable",
  oficina: "Oficina",
  chofer: "Chófer",
  operario: "Operario",
};
