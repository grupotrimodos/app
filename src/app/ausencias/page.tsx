import Cabecera from "../Cabecera";
import EstadoOdoo from "../EstadoOdoo";
import QuienAprueba from "../QuienAprueba";
import { conPermiso } from "@/lib/usuario";
import { fecha, hoyISO, NOMBRE_AUSENCIA } from "@/lib/jornada";
import { anularAusencia, pedirAusencia } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ausencias · Grupo Trimodos" };

const NOMBRE_ESTADO: Record<string, string> = {
  pendiente: "Pendiente", aprobada: "Aprobada", rechazada: "Rechazada", anulada: "Anulada",
};

type Ausencia = { id: number; tipo: string; desde: string; hasta: string; motivo: string | null; estado: string;
  comentario: string | null; odoo_estado: string; odoo_error: string | null };

const dias = (a: Ausencia) => Math.round((Date.parse(a.hasta) - Date.parse(a.desde)) / 86400000) + 1;

export default async function PaginaAusencias({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, uid, perfil } = await conPermiso("ausencias.pedir");
  const { ok, error } = await searchParams;
  const { data } = await supabase.from("ausencias")
    .select("id,tipo,desde,hasta,motivo,estado,comentario,odoo_estado,odoo_error")
    .eq("usuario_id", uid).order("desde", { ascending: false }).limit(50);
  const lista = (data ?? []) as Ausencia[];
  const hoy = hoyISO();

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
      <main className="contenido estrecho">
        <h1>Vacaciones y ausencias</h1>
        <QuienAprueba permiso="ausencias.aprobar" que="solicitudes" />
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <form action={pedirAusencia} className="panel">
          <h2>Pedir días</h2>
          <label htmlFor="tipo">Tipo</label>
          <select id="tipo" name="tipo" defaultValue="vacaciones">
            {Object.entries(NOMBRE_AUSENCIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="fila-form">
            <div><label htmlFor="desde">Desde</label><input id="desde" name="desde" type="date" min={hoy} required /></div>
            <div><label htmlFor="hasta">Hasta (incluido)</label><input id="hasta" name="hasta" type="date" min={hoy} /></div>
          </div>
          <label htmlFor="motivo">Comentario (opcional)</label>
          <input id="motivo" name="motivo" maxLength={300} />
          <button className="btn primario ancho" style={{ marginTop: 16 }}>Enviar solicitud</button>
        </form>

        <section className="panel">
          <h2>Mis solicitudes</h2>
          {lista.length === 0 ? <p className="hint">Todavía no has pedido ninguna.</p> : (
            <ul className="lista-fichajes">
              {lista.map((a) => (
                <li key={a.id}>
                  <b>{NOMBRE_AUSENCIA[a.tipo]}</b> · {fecha(a.desde + "T12:00:00Z")}
                  {a.hasta !== a.desde && <> – {fecha(a.hasta + "T12:00:00Z")}</>} ({dias(a)} {dias(a) === 1 ? "día" : "días"})
                  <div>
                    <span className={`etiqueta ${a.estado === "aprobada" ? "ok" : a.estado === "rechazada" ? "mal" : ""}`}>
                      {NOMBRE_ESTADO[a.estado]}
                    </span>{" "}
                    {a.estado === "aprobada" && <EstadoOdoo estado={a.odoo_estado} error={a.odoo_error} />}
                  </div>
                  {a.comentario && <p className="hint">Responsable: {a.comentario}</p>}
                  {a.estado === "pendiente" && (
                    <form action={anularAusencia}><input type="hidden" name="id" value={a.id} />
                      <button className="btn pequeno">Anular</button></form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
