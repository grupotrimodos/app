import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardarTokenMicrosoft } from "@/lib/outlook";

/** Vuelta del inicio de sesión de Microsoft: cambia el código por la sesión y entra. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const destino = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Para su calendario de Outlook (si está activado). Si falla, se entra igual: solo no se verá la agenda.
      const renovacion = data.session?.provider_refresh_token;
      if (renovacion && data.user) await guardarTokenMicrosoft(data.user.id, renovacion).catch(() => {});
      return NextResponse.redirect(`${origin}${destino}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=1`);
}
