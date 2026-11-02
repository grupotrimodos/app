export type EstadoVehiculo = "en_ruta" | "detenido" | "sin_senal" | "sin_datos";

export type VehiculoFlota = {
  id: string;
  matricula: string;
  tipo: string | null;
  modelo: string | null;
  fecha_posicion: string | null;
  latitud: number | null;
  longitud: number | null;
  velocidad_kmh: number | null;
  motor_encendido: boolean | null;
  estado: EstadoVehiculo;
  combustible_pct: number | null;
  combustible_litros: number | null;
  fecha_combustible: string | null;
  km_hoy: number | null;
  consumo_hoy_litros: number | null;
  consumo_medio_l_100km: number | null;
  datos_hoy_hasta: string | null;
  avisos: string[];
};

export type ResumenFlota = {
  modo: "real" | "mock";
  simulado: boolean;
  estado: "conectado" | "parcial" | "sin_configurar" | "error" | "simulado";
  actualizado_en: string;
  avisos: string[];
  vehiculos: VehiculoFlota[];
};

export type PuntoRecorrido = {
  fecha: string;
  latitud: number;
  longitud: number;
  velocidad_kmh: number | null;
  motor_encendido: boolean | null;
};

export type RecorridoFlota = {
  matricula: string;
  fecha: string;
  simulado: boolean;
  puntos: PuntoRecorrido[];
  puntos_totales: number;
  simplificado: boolean;
  avisos: string[];
};

export const NOMBRE_ESTADO_FLOTA: Record<EstadoVehiculo, string> = {
  en_ruta: "En movimiento", detenido: "Detenido", sin_senal: "Señal antigua", sin_datos: "Sin posición",
};

export function tienePosicion<T extends { latitud: number | null; longitud: number | null }>(v: T): v is T & { latitud: number; longitud: number } {
  return v.latitud !== null && v.longitud !== null && Number.isFinite(v.latitud) && Number.isFinite(v.longitud)
    && Math.abs(v.latitud) <= 90 && Math.abs(v.longitud) <= 180;
}

export const requiereAtencion = (v: VehiculoFlota) => v.estado === "sin_senal" || v.estado === "sin_datos"
  || (v.combustible_pct !== null && v.combustible_pct < 20) || v.avisos.length > 0;

export const numeroFlota = (n: number | null, decimales = 0) => n === null || !Number.isFinite(n) ? "—"
  : n.toLocaleString("es-ES", { maximumFractionDigits: decimales });

export function fechaFlota(iso: string | null): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return "Sin información";
  return new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}
