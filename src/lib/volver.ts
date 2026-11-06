import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Termina una acción volviendo a la misma página de la que viene (con su pestaña, su centro y sus filtros) y el mensaje.
 * Con varias `base`, vuelve a la de origen de entre ellas.
 * Lee la página de origen de la cabecera «Referer»: esa página tiene que mandarla dentro de la app (Referrer-Policy
 * «same-origin» en next.config.ts). Sin ella, vuelve a `base` sin filtros.
 */
export async function volverA(base: string | string[], msg: string, tipo: "ok" | "error" = "ok"): Promise<never> {
  const bases = Array.isArray(base) ? base : [base];
  let destino = bases[0];
  try {
    const u = new URL((await headers()).get("referer") ?? "");
    if (bases.includes(u.pathname)) {
      u.searchParams.delete("ok");
      u.searchParams.delete("error");
      destino = `${u.pathname}${u.search}`;
    }
  } catch { /* sin página de origen: a la portada de esa sección */ }
  redirect(`${destino}${destino.includes("?") ? "&" : "?"}${tipo}=${encodeURIComponent(msg)}`);
}
