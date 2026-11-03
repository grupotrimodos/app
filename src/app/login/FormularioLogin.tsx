"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CODIGO_RE, PIN_RE, correoDeCodigo } from "@/lib/pin";
import Icono from "../Icono";

/** `alcance`: lo que se pide a Microsoft además del correo (el calendario, solo si está activado en el servidor). */
export default function FormularioLogin({ destino, alcance = "" }: { destino: string; alcance?: string }) {
  const [codigo, setCodigo] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState<"microsoft" | "pin" | null>(null);

  async function conMicrosoft() {
    setError(null);
    setCargando("microsoft");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: { scopes: `email ${alcance}`.trim(), redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(destino)}` },
      });
      if (error) { setError("No se ha podido abrir el inicio de sesión de Microsoft. Inténtalo de nuevo."); setCargando(null); }
    } catch {
      setError("No se ha podido conectar. Comprueba tu conexión y vuelve a intentarlo.");
      setCargando(null);
    }
  }

  async function conPin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!CODIGO_RE.test(codigo.trim()) || !PIN_RE.test(pin)) { setError("Revisa el código y el PIN."); return; }
    setCargando("pin");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email: correoDeCodigo(codigo), password: pin });
      if (error) {
        setError(error.status === 429 ? "Demasiados intentos. Espera unos minutos." : "Código o PIN incorrectos.");
        setCargando(null);
        return;
      }
      location.assign(destino);
    } catch {
      setError("No se ha podido conectar. Comprueba tu conexión y vuelve a intentarlo.");
      setCargando(null);
    }
  }

  return <div className="login-formularios" aria-busy={Boolean(cargando)}>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="login-oficina" aria-labelledby="titulo-oficina">
      <h3 id="titulo-oficina">Personal de oficina</h3>
      <p className="hint">Utiliza tu cuenta de la empresa.</p>
      <button className="btn ancho login-microsoft" type="button" onClick={conMicrosoft} disabled={Boolean(cargando)}>
        <span className="login-microsoft-marca" aria-hidden="true"><i /><i /><i /><i /></span>
        {cargando === "microsoft" ? "Abriendo Microsoft…" : "Continuar con Microsoft"}
      </button>
    </section>
    <div className="separador">o entra con tu código</div>
    <form onSubmit={conPin} noValidate>
      <h3>Conductores y operarios</h3>
      <div className="login-campos"><div>
        <label htmlFor="codigo">Código de empleado</label>
        <input id="codigo" name="codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="username"
          autoCapitalize="characters" spellCheck={false} inputMode="text" placeholder="Tu código" disabled={Boolean(cargando)} required />
      </div><div>
        <label htmlFor="pin">PIN</label>
        <input id="pin" name="pin" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          autoComplete="current-password" inputMode="numeric" maxLength={12} placeholder="Tu PIN" disabled={Boolean(cargando)} required />
      </div></div>
      <button className="btn primario ancho login-entrar" disabled={Boolean(cargando)}>{cargando === "pin" ? "Entrando…" : "Entrar a mi espacio"}<Icono nombre="flecha" size={20} /></button>
      <p className="login-ayuda">¿No tienes código o has olvidado el PIN?<br /><strong>Contacta con tu oficina.</strong></p>
    </form>
  </div>;
}
