import Cabecera from "../Cabecera";
import EstadoOdoo from "../EstadoOdoo";
import { conPermiso } from "@/lib/usuario";
import {
  BOTON_TIPO, duracion, estadoDe, fecha, hora, inicioDia, jornadaEnCurso, minutosTrabajados, NOMBRE_ESTADO, NOMBRE_TIPO, SIGUIENTES,
  type Fichaje,
} from "@/lib/jornada";
import { fichar, reintentarOdoo } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fichaje · Grupo Trimodos" };

export default async function PaginaFichaje({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, uid, perfil } = await conPermiso("fichaje.fichar");
  const { ok, error } = await searchParams;
  const { data } = await supabase.from("fichajes")
    .select("id,usuario_id,tipo,momento,origen,nota,odoo_estado,odoo_error")
    .eq("usuario_id", uid).gte("momento", inicioDia(7).toISOString()).order("momento");
  const todos = (data ?? []) as Fichaje[];
  const desdeHoy = inicioDia().getTime();
  const hoy = todos.filter((f) => new Date(f.momento).getTime() >= desdeHoy);
  // La jornada puede empezar ayer (turno de noche): el estado se calcula con las últimas 24 h.
  const ultimas24 = todos.filter((f) => new Date(f.momento).getTime() >= inicioDia(1).getTime());
  const estado = estadoDe(ultimas24);
  const llevas = minutosTrabajados(estado === "fuera" ? hoy : jornadaEnCurso(ultimas24));
  const pendientes = todos.some((f) => f.odoo_estado === "error" || f.odoo_estado === "pendiente");

  const porDia = new Map<string, Fichaje[]>();
  for (const f of todos.filter((f) => new Date(f.momento).getTime() < desdeHoy)) {
    const d = fecha(f.momento);
    porDia.set(d, [...(porDia.get(d) ?? []), f]);
  }

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
      <main className="contenido estrecho">
        <h1>Fichaje</h1>
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <section className={`panel estado-jornada ${estado}`}>
          <p className="hint">Ahora mismo</p>
          <p className="estado-grande">{NOMBRE_ESTADO[estado]}</p>
          <p>{estado === "fuera" ? "Hoy has trabajado" : "Llevas"} <b>{duracion(llevas)}</b></p>
          <div className="botones-fichar">
            {SIGUIENTES[estado].map((t, i) => (
              <form key={t} action={fichar}>
                <input type="hidden" name="tipo" value={t} />
                <button className={`btn ancho grande ${i === 0 ? "primario" : ""}`}>{BOTON_TIPO[t]}</button>
              </form>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Hoy</h2>
          {hoy.length === 0 ? <p className="hint">Todavía no has fichado hoy.</p> : (
            <ul className="lista-fichajes">
              {hoy.map((f) => (
                <li key={f.id}>
                  <b>{hora(f.momento)}</b> {NOMBRE_TIPO[f.tipo]}
                  {f.origen === "camion" && <span className="hint"> · al confirmar el camión</span>}
                  {f.origen === "correccion" && <span className="hint"> · corregido por tu responsable: {f.nota}</span>}
                  <div><EstadoOdoo estado={f.odoo_estado} error={f.odoo_error} detalle /></div>
                </li>
              ))}
            </ul>
          )}
          {pendientes && (
            <form action={reintentarOdoo}><button className="btn pequeno">Reintentar envío a Odoo</button></form>
          )}
        </section>

        {porDia.size > 0 && (
          <section className="panel">
            <h2>Últimos días</h2>
            <table>
              <tbody>
                {[...porDia.entries()].reverse().map(([d, fs]) => (
                  <tr key={d}><td>{d}</td><td>{hora(fs[0].momento)} – {hora(fs.at(-1)!.momento)}</td>
                    <td><b>{duracion(minutosTrabajados(fs, new Date(fs.at(-1)!.momento)))}</b></td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <p className="hint">Si te has equivocado o se te olvidó fichar, díselo a tu responsable: él lo corrige y queda anotado.</p>
      </main>
    </>
  );
}
