/** Respuesta de la API Python al enviar fichajes a Odoo (servicios/rrhh.py, enviar_fichajes). */
export type EnvioFichajes = { enviados: number; errores: number; simulados?: number; sin_empleado?: number; detalle?: string };

/** Qué ha pasado de verdad con el envío, en una frase: nunca «enviado» si no ha llegado nada a Odoo. */
export function resultadoEnvio(r: EnvioFichajes | null, quien: "tu" | "su"): { texto: string; bien: boolean } {
  if (!r) return { texto: "El servicio no responde: se reintentará solo más tarde.", bien: false };
  if (r.sin_empleado) {
    return { texto: quien === "tu" ? "Falta tu ficha de empleado en Odoo: avisa a la administración para que la enlace."
      : "Falta su ficha de empleado en Odoo: hay que enlazarla en Administración.", bien: false };
  }
  if (r.errores) return { texto: `Odoo sigue sin aceptarlo${r.detalle ? ` (${r.detalle})` : ""}.`, bien: false };
  if (r.enviados) return { texto: "Enviado a Odoo.", bien: true };
  if (r.simulados) return { texto: "Modo prueba: no se envía a Odoo.", bien: true };
  return { texto: "No había nada pendiente de enviar a Odoo.", bien: true };
}
