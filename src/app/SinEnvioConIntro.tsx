/**
 * Primer botón (invisible y desactivado) de un formulario con varias decisiones: al pulsar Intro en un campo de texto
 * el navegador usa el primer botón del formulario; si está desactivado, no envía nada. Así escribir un comentario y
 * pulsar Intro no aprueba sin querer: hay que pulsar «Aprobar» o «Rechazar».
 */
export default function SinEnvioConIntro() {
  return <button type="submit" disabled hidden aria-hidden="true" tabIndex={-1} />;
}
