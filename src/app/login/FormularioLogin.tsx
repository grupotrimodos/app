"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CODIGO_RE, PIN_RE, correoDeCodigo } from "@/lib/pin";

export default function FormularioLogin({ destino }: { destino: string }) {
  const [codigo, setCodigo] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function conMicrosoft() {
    setError(null);
    setCargando(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "email",
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(destino)}`,
      },
    });
    if (error) {
      setError("No se ha podido abrir el inicio de sesión de Microsoft.");
      setCargando(false);
    }
  }

  async function conPin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!CODIGO_RE.test(codigo.trim()) || !PIN_RE.test(pin)) {
      setError("Revisa el código y el PIN.");
      return;
    }
    setCargando(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: correoDeCodigo(codigo), password: pin });
    if (error) {
      setError(error.status === 429 ? "Demasiados intentos. Espera unos minutos." : "Código o PIN incorrectos.");
      setCargando(false);
      return;
    }
    location.assign(destino);   // navegación completa: también sirve para /deca/, que no es una página de Next
  }

  return (
    <>
      <section className="panel">
        <h2>Personal de oficina</h2>
        <p className="hint">Con tu cuenta de la empresa (Microsoft).</p>
        <button className="btn primario ancho" onClick={conMicrosoft} disabled={cargando}>
          Entrar con Microsoft
        </button>
      </section>

      <div className="separador">o</div>

      <form className="panel" onSubmit={conPin} noValidate>
        <h2>Conductores y operarios</h2>
        <label htmlFor="codigo">Código</label>
        <input id="codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="username"
          autoCapitalize="characters" spellCheck={false} inputMode="text" />
        <label htmlFor="pin">PIN</label>
        <input id="pin" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          autoComplete="current-password" inputMode="numeric" maxLength={12} />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primario ancho" style={{ marginTop: 16 }} disabled={cargando}>Entrar</button>
        <p className="hint">¿No tienes código o has olvidado el PIN? Pídelo en la oficina.</p>
      </form>
    </>
  );
}
