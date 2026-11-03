import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/** Cliente con la clave secreta: SOLO para lo que exige administrador (crear usuario, cambiar PIN) y para los tokens
 *  de Outlook, que ningún usuario puede leer (src/lib/outlook.ts). */
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Falta SUPABASE_SECRET_KEY en el entorno.");
  return createClient(SUPABASE_URL, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
