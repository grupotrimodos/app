import type { NextRequest } from "next/server";
import { actualizarSesion } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return actualizarSesion(request);
}

export const config = {
  // Fuera: estáticos, la PWA de DECA (se protege por su API y funciona sin cobertura) y la API Python.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|deca|api/deca/|api/argon/|api/rrhh/|api/chofer/|api/flota/|api/odoo/|.*\\.(?:png|jpg|svg|ico|webp|woff2|webmanifest)$).*)"],
};
