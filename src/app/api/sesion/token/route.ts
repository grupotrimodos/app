import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigurado } from "@/lib/supabase/env";

/**
 * Token de la sesión actual para los módulos que no son páginas de Next (la PWA de DECA): lo mandan a la API Python
 * como «Authorization: Bearer». Misma web y sin caché.
 */
export async function GET() {
  if (!supabaseConfigurado()) {
    // Solo en local y sin Supabase: token de prueba (la API Python, en modo simulado, entra como «Usuario de prueba»).
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ token: "prueba", exp: Math.floor(Date.now() / 1000) + 3600 }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "La app no está configurada." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();   // valida el token (y lo renueva si hace falta)
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!claims?.claims?.sub || !s) {
    return NextResponse.json({ error: "Tienes que iniciar sesión." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ token: s.access_token, exp: s.expires_at }, { headers: { "Cache-Control": "no-store" } });
}
