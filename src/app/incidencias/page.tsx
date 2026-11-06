import Cabecera from "../Cabecera";
import { fecha, hora } from "@/lib/jornada";
import { ESTADO_INCIDENCIA, GRAVEDAD, TIPOS_INCIDENCIA } from "@/lib/seguridad";
import { conPermiso } from "@/lib/usuario";
import { reportarIncidencia } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Incidencias · Grupo Trimodos" };

type Incidencia = { id: number; ocurrio: string; tipo: string; gravedad: string; descripcion: string; estado: string; medidas: string | null };

export default async function Incidencias({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, uid, perfil } = await conPermiso("incidencias.reportar");
  const { ok, error } = await searchParams;
  const [{ data: mias }, { data: vehiculos }] = await Promise.all([
    supabase.from("incidencias").select("id,ocurrio,tipo,gravedad,descripcion,estado,medidas")
      .eq("reportado_por", uid).order("creado", { ascending: false }).limit(20).returns<Incidencia[]>(),
    supabase.from("vehiculos").select("id,matricula").eq("activo", true).order("matricula").returns<{ id: number; matricula: string }[]>(),
  ]);

  return <>
    <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
    <main className="contenido estrecho">
      <h1>Incidencias</h1>
      <p className="lead">¿Ha pasado algo? Cuéntalo aquí y le llega a seguridad al momento. Si hay heridos, llama primero al 112.</p>
      {ok && <p className="aviso" role="status">{ok}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <section className="panel">
        <h2>Avisar de una incidencia</h2>
        <form action={reportarIncidencia} className="formulario-incidencia">
          <div className="fila-form">
            <div><label htmlFor="inc-tipo">Qué ha sido</label>
              <select id="inc-tipo" name="tipo" required defaultValue="">
                <option value="" disabled>Elige…</option>
                {Object.entries(TIPOS_INCIDENCIA).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select></div>
            <div><label htmlFor="inc-gravedad">Gravedad</label>
              <select id="inc-gravedad" name="gravedad" defaultValue="leve">
                {Object.entries(GRAVEDAD).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select></div>
          </div>
          <div className="fila-form">
            <div><label htmlFor="inc-cuando">Cuándo (si no fue ahora)</label><input id="inc-cuando" type="datetime-local" name="ocurrio" /></div>
            <div><label htmlFor="inc-lugar">Dónde</label><input id="inc-lugar" name="lugar" maxLength={120} placeholder="Ej.: muelle 3, A-7 km 120" /></div>
          </div>
          {(vehiculos ?? []).length > 0 && <div><label htmlFor="inc-vehiculo">Camión (si tiene que ver)</label>
            <select id="inc-vehiculo" name="vehiculo" defaultValue="">
              <option value="">Ninguno</option>
              {(vehiculos ?? []).map((v) => <option key={v.id} value={v.id}>{v.matricula}</option>)}
            </select></div>}
          <label htmlFor="inc-descripcion">Qué ha pasado</label>
          <textarea id="inc-descripcion" name="descripcion" required minLength={3} maxLength={2000} rows={4} />
          <button className="btn primario ancho grande">Enviar a seguridad</button>
        </form>
      </section>

      <section className="panel">
        <h2>Las que has enviado</h2>
        {(mias ?? []).length === 0 ? <p className="hint">Todavía no has enviado ninguna.</p> : <ul className="lista-incidencias">
          {(mias ?? []).map((i) => <li key={i.id}>
            <div><b>{TIPOS_INCIDENCIA[i.tipo] ?? i.tipo}</b> · {GRAVEDAD[i.gravedad] ?? i.gravedad}
              <span className={`etiqueta ${i.estado === "cerrada" ? "ok" : i.estado === "abierta" ? "pronto" : ""}`}>{ESTADO_INCIDENCIA[i.estado] ?? i.estado}</span></div>
            <p className="hint">{fecha(i.ocurrio)}, {hora(i.ocurrio)} · {i.descripcion}</p>
            {i.medidas && <p className="hint"><b>Respuesta de seguridad:</b> {i.medidas}</p>}
          </li>)}
        </ul>}
      </section>
    </main>
  </>;
}
