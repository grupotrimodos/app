import Cabecera from "../Cabecera";
import { documentosDe } from "@/lib/documentos";
import { CLASE_CADUCIDAD, DIAS_AVISO, fechaLarga, NOMBRE_CADUCIDAD, SIN_CADUCIDAD } from "@/lib/seguridad";
import { conPermiso } from "@/lib/usuario";
import { guardarMiDocumento } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi documentación · Grupo Trimodos" };

export default async function MiDocumentacion({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, uid, perfil } = await conPermiso("documentos.propios");
  const { ok, error } = await searchParams;
  const { situacion } = await documentosDe(supabase, uid);
  const pendientes = situacion.filter((s) => s.estado !== "al_dia").length;

  return <>
    <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
    <main className="contenido estrecho">
      <h1>Mi documentación</h1>
      <p className="lead">Apunta cuándo caduca cada documento de tu puesto. Te avisaremos {DIAS_AVISO} días antes.</p>
      {ok && <p className="aviso" role="status">{ok}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {situacion.length === 0 ? <section className="panel">
        <p className="hint">Tu puesto no pide ninguna documentación. Si crees que falta algo, díselo a la oficina.</p>
      </section> : <>
        {pendientes > 0 && <p className="aviso">Te {pendientes === 1 ? "queda 1 documento" : `quedan ${pendientes} documentos`} por poner al día.</p>}
        {situacion.map((s) => <section key={s.tipo} className="panel documento">
          <div className="documento-cabecera">
            <h2>{s.nombre}</h2>
            <span className={`etiqueta ${CLASE_CADUCIDAD[s.estado]}`}>
              {NOMBRE_CADUCIDAD[s.estado]}{s.doc?.caduca ? ` · ${fechaLarga(s.doc.caduca)}` : ""}
            </span>
          </div>
          <form action={guardarMiDocumento} className="fila-form">
            <input type="hidden" name="tipo" value={s.tipo} />
            <div>
              <label htmlFor={`caduca-${s.tipo}`}>{SIN_CADUCIDAD.has(s.tipo) ? "Caduca el (si caduca)" : "Caduca el"}</label>
              <input id={`caduca-${s.tipo}`} type="date" name="caduca" defaultValue={s.doc?.caduca ?? ""} required={!SIN_CADUCIDAD.has(s.tipo)} />
            </div>
            <div>
              <label htmlFor={`numero-${s.tipo}`}>Número (opcional)</label>
              <input id={`numero-${s.tipo}`} name="numero" defaultValue={s.doc?.numero ?? ""} maxLength={60} />
            </div>
            <button className="btn primario">{s.doc ? "Guardar" : "Lo tengo, guardar"}</button>
          </form>
        </section>)}
      </>}
    </main>
  </>;
}
