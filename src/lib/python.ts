import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Llama a la API Python (Odoo, Movildata) desde el servidor con el token del usuario: allí se aplican SUS permisos.
 * En local va directa a uvicorn (puerto 8000). En Vercel, en producción, al dominio de producción: la dirección propia
 * de cada despliegue (VERCEL_URL) la tapa el login de Vercel y la llamada no llegaría. En las vistas previas, a la suya.
 */
function base() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:8000";
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://127.0.0.1:8000";
}

/** El error de la API Python es un texto; otros (p. ej. el propio Vercel) responden { code, message }. A la pantalla, solo texto. */
function mensajeDeError(json: unknown): string {
  const e = (json as { error?: unknown } | null)?.error;
  return typeof e === "string" && e ? e : "No se ha podido contactar con el servicio.";
}

/** Como llamarPython, pero devuelve también el mensaje de error de la API (para enseñarlo en pantallas de gestión). */
export async function llamarPythonDetalle<T = unknown>(
  ruta: string, init: { method?: string; body?: unknown; espera?: number } = {},
): Promise<{ datos: T | null; error: string | null }> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { datos: null, error: "Tienes que iniciar sesión." };
    const res = await fetch(base() + ruta, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(init.espera ?? 9000),
    });
    const json = await res.json().catch(() => null);
    // Sin JSON (p. ej. la página de login de Vercel) tampoco es una respuesta de la API.
    if (!res.ok || json === null) return { datos: null, error: mensajeDeError(json) };
    return { datos: json as T, error: null };
  } catch {
    return { datos: null, error: "El servicio no responde. Inténtalo de nuevo en un momento." };
  }
}

export async function llamarPython<T = unknown>(ruta: string, init: { method?: string; body?: unknown } = {}): Promise<T | null> {
  // Si falla, el dato ya está guardado en Supabase: el envío a Odoo se reintenta después.
  return (await llamarPythonDetalle<T>(ruta, init)).datos;
}
