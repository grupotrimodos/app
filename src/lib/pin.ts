/** Conductores y operarios entran con código + PIN. Por dentro, Supabase usa un correo interno que nunca ven. */
export const DOMINIO_PIN = "pin.grupotrimodos.com";
export const CODIGO_RE = /^[A-Za-z0-9]{3,20}$/;
export const PIN_RE = /^\d{6,12}$/;
export const correoDeCodigo = (codigo: string) => `${codigo.trim().toLowerCase()}@${DOMINIO_PIN}`;
