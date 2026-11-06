import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL, supabaseConfigurado } from "./env";

const PUBLICAS = ["/login", "/auth/"];

/** Renueva la sesión en cada petición y manda al login a quien no la tenga. */
export async function actualizarSesion(request: NextRequest) {
  if (!supabaseConfigurado()) {
    // Sin Supabase no hay login: solo responde la API (en local, DECA en modo simulado). Nunca se abre la app sin control.
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
    return new NextResponse(
      "<!doctype html><meta charset=utf-8><title>Sin configurar</title><p style=\"font:18px system-ui;padding:24px\">" +
        "La app no está configurada: faltan las variables de Supabase (ver README).</p>",
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // No poner código entre createServerClient y getClaims: es lo que renueva el token.
  const { data } = await supabase.auth.getClaims();
  const conSesion = Boolean(data?.claims?.sub);

  const ruta = request.nextUrl.pathname;
  const publica = PUBLICAS.some((p) => ruta === p || ruta.startsWith(p));
  if (!conSesion && !publica && !ruta.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = ruta === "/" || ruta === "/salir" ? "" : `?next=${encodeURIComponent(ruta + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}
