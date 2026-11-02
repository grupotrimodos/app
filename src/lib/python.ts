import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Llama a la API Python (Odoo, Movildata) desde el servidor con el token del usuario: allí se aplican SUS permisos.
 * En local va directa a uvicorn (puerto 8000); en Vercel, al propio despliegue.
 */
function base() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:8000";
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://127.0.0.1:8000";
}

export async function llamarPython<T = unknown>(ruta: string, init: { method?: string; body?: unknown } = {}): Promise<T | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const res = await fetch(base() + ruta, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;   // el dato ya está guardado en Supabase: el envío a Odoo se reintenta después
  }
}
