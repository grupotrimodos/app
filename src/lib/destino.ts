/**
 * Adónde volver después de entrar (?next=). Solo una ruta de esta misma app: empieza por una sola «/» y no lleva
 * espacios, tabuladores, saltos de línea ni «\». El navegador quita esos caracteres invisibles, así que «/\t/web.com»
 * acabaría siendo «//web.com», es decir, otra web. Cualquier otra cosa vuelve al inicio.
 */
const RUTA_PROPIA = /^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/;

export function destinoSeguro(next: string | null | undefined): string {
  return next && RUTA_PROPIA.test(next) ? next : "/";
}
