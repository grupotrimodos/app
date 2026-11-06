import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Termina una acción volviendo a la misma página de la que viene (con su pestaña, su centro y sus filtros) y el mensaje.
 * Lee la página de origen de la cabecera «Referer»: esa página tiene que mandarla dentro de la app (Referrer-Policy
 * «same-origin» en next.config.ts). Sin ella, vuelve a `base` sin filtros.
 */
export async function volverA(base: string, msg: string, tipo: "ok" | "error" = "ok"): Promise<never> {
  let destino = base;
  try {
    const u = new URL((await headers()).get("referer") ?? "");
    if (u.pathname === base) {
      u.searchParams.delete("ok");
      u.searchParams.delete("error");
      destino = `${base}${u.search}`;
    }
  } catch { /* sin página de origen: a la portada de esa sección */ }
  redirect(`${destino}${destino.includes("?") ? "&" : "?"}${tipo}=${encodeURIComponent(msg)}`);
}
