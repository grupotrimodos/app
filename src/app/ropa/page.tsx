import Cabecera from "../Cabecera";
import { fecha } from "@/lib/jornada";
import { CLASE_ROPA, ESTADO_ROPA, MAX_UNIDADES, MOTIVOS_ROPA, PRENDAS, textoLinea, type LineaRopa } from "@/lib/ropa";
import { conPermiso } from "@/lib/usuario";
import { anularRopa, entregarRopa, pedirRopa, resolverRopa } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ropa de trabajo · Grupo Trimodos" };

type Solicitud = {
  id: number; usuario_id: string; creado: string; prendas: LineaRopa[]; motivo: string; nota: string | null; estado: string;
  comentario: string | null; entregado_en: string | null;
};
const CAMPOS = "id,usuario_id,creado,prendas,motivo,nota,estado,comentario,entregado_en";

function Etiqueta({ estado }: { estado: string }) {
  return <span className={`etiqueta ${CLASE_ROPA[estado] ?? ""}`}>{ESTADO_ROPA[estado] ?? estado}</span>;
}

export default async function Ropa({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, uid, perfil, veArea, puede } = await conPermiso("ropa.pedir", "ropa.gestionar");
  const { ok, error } = await searchParams;
  const pide = puede("ropa.pedir"), gestiona = puede("ropa.gestionar");
  const [{ data: mias }, { data: equipo }] = await Promise.all([
    pide ? supabase.from("solicitudes_ropa").select(CAMPOS).eq("usuario_id", uid).order("creado", { ascending: false }).limit(10).returns<Solicitud[]>()
      : Promise.resolve({ data: [] as Solicitud[] }),
    // La base de datos solo devuelve las de las personas de sus centros (todas, si es superadministrador).
    gestiona ? supabase.from("solicitudes_ropa").select(CAMPOS).neq("usuario_id", uid).in("estado", ["pendiente", "aprobada"])
      .order("creado").limit(100).returns<Solicitud[]>() : Promise.resolve({ data: [] as Solicitud[] }),
  ]);
  const ids = [...new Set((equipo ?? []).map((s) => s.usuario_id))];
  const { data: personas } = ids.length
    ? await supabase.from("usuarios").select("id,nombre,email,codigo").in("id", ids)
      .returns<{ id: string; nombre: string; email: string | null; codigo: string | null }[]>()
    : { data: [] };
  const nombre = new Map((personas ?? []).map((p) => [p.id, p.nombre || p.codigo || p.email || "—"]));
  const pendientes = (equipo ?? []).filter((s) => s.estado === "pendiente");
  const porEntregar = (equipo ?? []).filter((s) => s.estado === "aprobada");

  return <>
    <Cabecera nombre={perfil.nombre || perfil.email || perfil.codigo || ""} admin={veArea("admin")} />
    <main className="contenido estrecho">
      <h1>Ropa de trabajo</h1>
      <p className="lead">{pide ? "Pide la ropa y los EPIs que necesitas. Le llega a tu responsable y aquí ves cómo va."
        : "Los pedidos de ropa de las personas de tus centros."}</p>
      {ok && <p className="aviso" role="status">{ok}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {gestiona && <section className="panel">
        <h2>Por aprobar ({pendientes.length})</h2>
        {pendientes.length === 0 ? <p className="hint">No hay pedidos esperando.</p> : <ul className="lista-incidencias">
          {pendientes.map((s) => <li key={s.id}>
            <div><b>{nombre.get(s.usuario_id) ?? "—"}</b> <span className="hint">· {fecha(s.creado)} · {MOTIVOS_ROPA[s.motivo] ?? s.motivo}</span></div>
            <ul className="lista-ropa">{s.prendas.map((l, i) => <li key={i}>{textoLinea(l)}</li>)}</ul>
            {s.nota && <p className="hint">«{s.nota}»</p>}
            <form action={resolverRopa} className="fila-form">
              <input type="hidden" name="id" value={s.id} />
              <div className="crece"><label htmlFor={`com-${s.id}`}>Comentario (obligatorio si lo rechazas)</label>
                <input id={`com-${s.id}`} name="comentario" maxLength={300} /></div>
              <button className="btn primario" name="decision" value="aprobar">Aprobar</button>
              <button className="btn" name="decision" value="rechazar">Rechazar</button>
            </form>
          </li>)}
        </ul>}
      </section>}

      {gestiona && porEntregar.length > 0 && <section className="panel">
        <h2>Aprobados, por entregar ({porEntregar.length})</h2>
        <ul className="lista-incidencias">
          {porEntregar.map((s) => <li key={s.id}>
            <div><b>{nombre.get(s.usuario_id) ?? "—"}</b> <span className="hint">· pedido el {fecha(s.creado)}</span></div>
            <ul className="lista-ropa">{s.prendas.map((l, i) => <li key={i}>{textoLinea(l)}</li>)}</ul>
            <form action={entregarRopa}>
              <input type="hidden" name="id" value={s.id} />
              <button className="btn pequeno">Marcar como entregado</button>
            </form>
          </li>)}
        </ul>
      </section>}

      {pide && <section className="panel">
        <h2>Pedir ropa</h2>
        <form action={pedirRopa}>
          <p className="hint">Pon cuántas necesitas de cada prenda y su talla. Lo que dejes en 0 no se pide.</p>
          <div className="tabla-ropa">
            {Object.entries(PRENDAS).map(([id, p]) => <div key={id} className="fila-ropa">
              <span className="fila-ropa-nombre">{p.nombre}</span>
              {p.tallas.length > 1
                ? <select name={`talla_${id}`} aria-label={`Talla de ${p.nombre}`} defaultValue="">
                    <option value="">Talla</option>{p.tallas.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                : <span className="hint fila-ropa-unica">Talla única</span>}
              <select name={`cantidad_${id}`} aria-label={`Cuántas ${p.nombre}`} defaultValue="0">
                {Array.from({ length: MAX_UNIDADES + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>)}
          </div>
          <label htmlFor="ropa-motivo">Motivo</label>
          <select id="ropa-motivo" name="motivo" required defaultValue="">
            <option value="" disabled>Elige…</option>
            {Object.entries(MOTIVOS_ROPA).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
          <label htmlFor="ropa-nota">Algo más (opcional)</label>
          <input id="ropa-nota" name="nota" maxLength={500} placeholder="Ej.: las botas actuales tienen la suela rota" />
          <button className="btn primario ancho grande" style={{ marginTop: 18 }}>Enviar a mi responsable</button>
        </form>
      </section>}

      {pide && <section className="panel">
        <h2>Mis pedidos</h2>
        {(mias ?? []).length === 0 ? <p className="hint">Todavía no has pedido nada.</p> : <ul className="lista-incidencias">
          {(mias ?? []).map((s) => <li key={s.id}>
            <div><b>{fecha(s.creado)}</b> <Etiqueta estado={s.estado} /></div>
            <ul className="lista-ropa">{s.prendas.map((l, i) => <li key={i}>{textoLinea(l)}</li>)}</ul>
            {s.comentario && <p className="hint"><b>Tu responsable:</b> {s.comentario}</p>}
            {s.entregado_en && <p className="hint">Entregado el {fecha(s.entregado_en)}.</p>}
            {s.estado === "pendiente" && <form action={anularRopa}>
              <input type="hidden" name="id" value={s.id} />
              <button className="btn pequeno">Anular este pedido</button>
            </form>}
          </li>)}
        </ul>}
      </section>}
    </main>
  </>;
}
