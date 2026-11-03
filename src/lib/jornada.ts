/** Utilidades de fecha (zona de Madrid) y del estado de la jornada a partir de los fichajes. */
export const ZONA = "Europe/Madrid";

export type Fichaje = {
  id: number; usuario_id: string; tipo: "entrada" | "pausa" | "reanudar" | "salida"; momento: string;
  origen: "app" | "camion" | "correccion"; nota: string | null; odoo_estado: string; odoo_error: string | null;
};
export type Estado = "fuera" | "trabajando" | "pausa";

/** Medianoche (hora de Madrid) de hoy o de hace `dias` días, como instante. Respeta los cambios de hora. */
export function inicioDia(dias = 0): Date {
  const [y, m, d] = hoyISO().split("-").map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d - dias)).toISOString().slice(0, 10);
  return madridAInstante(`${dia}T00:00`)!;
}

/** Lunes (hora de Madrid) de esta semana, como instante. */
export function inicioSemana(): Date {
  const diaSemana = new Date(`${hoyISO()}T12:00:00Z`).getUTCDay();   // 0 = domingo
  return inicioDia((diaSemana + 6) % 7);
}

export const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-ES", { timeZone: ZONA, hour: "2-digit", minute: "2-digit" });
export const fecha = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("es-ES", { timeZone: ZONA, weekday: "short", day: "numeric", month: "short" });
export const hoyISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: ZONA });   // AAAA-MM-DD

export function estadoDe(fichajes: Fichaje[]): Estado {
  const ultimo = [...fichajes].sort((a, b) => a.momento.localeCompare(b.momento)).at(-1);
  if (!ultimo || ultimo.tipo === "salida") return "fuera";
  return ultimo.tipo === "pausa" ? "pausa" : "trabajando";
}

/** Minutos trabajados: de cada entrada/reanudar a la siguiente pausa/salida (o hasta ahora). */
export function minutosTrabajados(fichajes: Fichaje[], ahora = new Date()): number {
  let total = 0;
  let desde: number | null = null;
  for (const f of [...fichajes].sort((a, b) => a.momento.localeCompare(b.momento))) {
    const t = new Date(f.momento).getTime();
    if (f.tipo === "entrada" || f.tipo === "reanudar") desde ??= t;
    else if (desde !== null) { total += t - desde; desde = null; }
  }
  if (desde !== null) total += ahora.getTime() - desde;
  return Math.max(0, Math.round(total / 60000));
}

/** Minutos trabajados en varios días, cada día por separado: una salida olvidada no alarga el total al día siguiente. */
export function minutosPorDia(fichajes: Fichaje[], ahora = new Date()): number {
  const dias = new Map<string, Fichaje[]>();
  for (const f of fichajes) {
    const d = new Date(f.momento).toLocaleDateString("sv-SE", { timeZone: ZONA });
    dias.set(d, [...(dias.get(d) ?? []), f]);
  }
  let total = 0;
  for (const [d, fs] of dias) {
    const ultimo = fs.reduce((a, f) => (f.momento.localeCompare(a) > 0 ? f.momento : a), fs[0].momento);
    total += minutosTrabajados(fs, d === hoyISO() ? ahora : new Date(ultimo));
  }
  return total;
}

export const duracion = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;

/** Fichajes de la jornada en curso (desde la última entrada), aunque empezara ayer (turno de noche). */
export function jornadaEnCurso(fichajes: Fichaje[]): Fichaje[] {
  const orden = [...fichajes].sort((a, b) => a.momento.localeCompare(b.momento));
  const i = orden.map((f) => f.tipo).lastIndexOf("entrada");
  return i < 0 ? [] : orden.slice(i);
}

/** Qué fichajes se pueden hacer desde cada estado. */
export const SIGUIENTES: Record<Estado, Fichaje["tipo"][]> = {
  fuera: ["entrada"],
  trabajando: ["pausa", "salida"],
  pausa: ["reanudar", "salida"],
};
export const NOMBRE_TIPO: Record<Fichaje["tipo"], string> = {
  entrada: "Entrada", pausa: "Pausa", reanudar: "Vuelta de la pausa", salida: "Salida",
};
export const BOTON_TIPO: Record<Fichaje["tipo"], string> = {
  entrada: "Fichar entrada", pausa: "Empezar pausa", reanudar: "Volver de la pausa", salida: "Fichar salida",
};
export const NOMBRE_ESTADO: Record<Estado, string> = { fuera: "Sin fichar", trabajando: "Trabajando", pausa: "En pausa" };

export const ESTADO_ODOO: Record<string, string> = {
  pendiente: "Pendiente de enviar a Odoo", enviado: "En Odoo", simulado: "Modo prueba (no se envía a Odoo)",
  error: "No se ha podido enviar a Odoo", sin_empleado: "Sin ficha de empleado en Odoo", no_aplica: "",
};

export const NOMBRE_AUSENCIA: Record<string, string> = {
  vacaciones: "Vacaciones", asuntos_propios: "Asuntos propios", medico: "Médico", otro: "Otro motivo",
};

/** «AAAA-MM-DDTHH:MM» (hora de Madrid, como lo da un <input type="datetime-local">) → instante. */
export function madridAInstante(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const supuesto = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(supuesto)).map((x) => [x.type, x.value]),
  );
  const desfase = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - supuesto;
  return new Date(supuesto - desfase);
}
