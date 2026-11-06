import Link from "next/link";
import Cabecera from "../Cabecera";
import QuienAprueba from "../QuienAprueba";
import SinEnvioConIntro from "../SinEnvioConIntro";
import { fecha } from "@/lib/jornada";
import {
  CLASE_DOTACION, CLASE_ROPA, ESTADO_DOTACION, ESTADO_ROPA, GRUPOS_TALLA, MAX_UNIDADES, MOTIVOS_CAMBIO, MOTIVOS_ROPA, nombreTemporada,
  PRENDAS, tallaDe, tallasQueFaltan, temporadaActual, textoKit, textoLinea, type LineaKit, type LineaRopa, type Tallas,
} from "@/lib/ropa";
import { centrosConPermiso, conPermiso } from "@/lib/usuario";
import {
  anularRopa, confirmarDotacion, entregarDotacion, entregarRopa, guardarKit, guardarTallas, pedirRopa, resolverRopa,
} from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ropa de trabajo · Grupo Trimodos" };

type Solicitud = {
  id: number; usuario_id: string; creado: string; prendas: LineaRopa[]; motivo: string; nota: string | null; estado: string;
  comentario: string | null; entregado_en: string | null;
};
type Dotacion = { id: number; usuario_id: string; prendas: LineaKit[]; estado: string; entregado_en: string | null; recibido_en: string | null };
type Persona = { id: string; nombre: string; codigo: string | null; email: string | null; usuario_perfil: { centro_id: number | null }[] };
type Kit = { perfil_id: number; temporada: string; prendas: LineaKit[]; mudas: number };
const CAMPOS = "id,usuario_id,creado,prendas,motivo,nota,estado,comentario,entregado_en";

const Etiqueta = ({ estado }: { estado: string }) => <span className={`etiqueta ${CLASE_ROPA[estado] ?? ""}`}>{ESTADO_ROPA[estado] ?? estado}</span>;

/** Las cuatro tallas de una persona (la de arriba, pantalón, calzado y guantes). */
function FormTallas({ tallas, usuario, volver, boton = "Guardar mis tallas" }: { tallas: Tallas | null; usuario?: string; volver: string; boton?: string }) {
  return <form action={guardarTallas} className="ropa-tallas">
    {usuario && <input type="hidden" name="usuario" value={usuario} />}
    <input type="hidden" name="volver" value={volver} />
    {Object.entries(GRUPOS_TALLA).map(([g, d]) => <div key={g}>
      <label htmlFor={`t-${usuario ?? "yo"}-${g}`}>{d.nombre}</label>
      <select id={`t-${usuario ?? "yo"}-${g}`} name={`talla_${g}`} defaultValue={tallas?.[g as keyof Tallas] ?? ""}>
        <option value="">—</option>{d.tallas.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>)}
    <button className="btn primario">{boton}</button>
  </form>;
}

export default async function Ropa({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; ver?: string; centro?: string; todas?: string }> }) {
  const { supabase, uid, perfil, puede, esDeSuPuesto } = await conPermiso("ropa.pedir", "ropa.gestionar", "ropa.configurar");
  const { ok, error, ver, centro, todas } = await searchParams;
  const pide = esDeSuPuesto("ropa.pedir"), gestiona = puede("ropa.gestionar"), configura = puede("ropa.configurar");
  const pestanas = ([
    ["mia", "Mi ropa", pide], ["temporada", "Temporada", gestiona], ["cambios", "Cambios", gestiona], ["composicion", "Composición", configura],
  ] as const).filter(([, , si]) => si);
  const vista = pestanas.find(([id]) => id === ver)?.[0] ?? pestanas[0][0];
  const t = temporadaActual();
  // La dotación de la temporada se prepara sola (a quien le toque por su puesto); así siempre está al día.
  await supabase.rpc("preparar_dotaciones");

  return <>
    <Cabecera nombre={perfil.nombre || perfil.email || perfil.codigo || ""} />
    <main className={`contenido ${vista === "mia" ? "estrecho" : ""}`}>
      <h1>Ropa de trabajo</h1>
      <p className="lead">{vista === "mia" ? `Tu ropa de ${nombreTemporada(t)}: dos mudas completas que te llegan sin pedirlas.`
        : `Dotación de ${nombreTemporada(t)} de las personas de tus centros, cambios y composición por puesto.`}</p>
      {pestanas.length > 1 && <nav className="pestanas" aria-label="Secciones de ropa">
        {pestanas.map(([id, nombre]) => <Link key={id} href={`/ropa?ver=${id}`} className={vista === id ? "activa" : ""}
          aria-current={vista === id ? "page" : undefined}>{nombre}</Link>)}
      </nav>}
      {ok && <p className="aviso" role="status">{ok}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {vista === "mia" && <MiRopa uid={uid} temporada={t} />}
      {vista === "temporada" && <Temporada uid={uid} esAdmin={perfil.es_admin} temporada={t} centro={centro} todas={todas === "1"} />}
      {vista === "cambios" && <Cambios uid={uid} />}
      {vista === "composicion" && <Composicion />}
    </main>
  </>;
}

/* ---------------------------------------------------------------- la persona: su ropa, sus tallas y sus cambios */
async function MiRopa({ uid, temporada }: { uid: string; temporada: string }) {
  const { supabase } = await conPermiso("ropa.pedir");
  const [{ data: dot }, { data: tr }, { data: mias }] = await Promise.all([
    supabase.from("ropa_dotaciones").select("id,usuario_id,prendas,estado,entregado_en,recibido_en").eq("usuario_id", uid)
      .eq("temporada", temporada).maybeSingle<Dotacion>(),
    supabase.from("tallas_ropa").select("tallas").eq("usuario_id", uid).maybeSingle<{ tallas: Tallas }>(),
    supabase.from("solicitudes_ropa").select(CAMPOS).eq("usuario_id", uid).order("creado", { ascending: false }).limit(10).returns<Solicitud[]>(),
  ]);
  const tallas = tr?.tallas ?? null;
  const faltan = dot ? tallasQueFaltan(dot.prendas, tallas) : [];
  return <>
    <section className="panel ropa-dotacion">
      <div className="ropa-dotacion-cabecera">
        <h2>{nombreTemporada(temporada)}</h2>
        {dot && <span className={`etiqueta ${CLASE_DOTACION[dot.estado]}`}>{ESTADO_DOTACION[dot.estado]}</span>}
      </div>
      {!dot ? <p className="hint">Tu puesto no tiene ropa de temporada. Si crees que es un error, díselo a tu responsable.</p> : <>
        <ul className="lista-ropa grande">{dot.prendas.map((l) => <li key={l.prenda}>{textoKit(l, tallas)}</li>)}</ul>
        {faltan.length > 0 && <p className="aviso">Apunta tus tallas aquí abajo para que te la preparen.</p>}
        {dot.estado === "entregada" && <form action={confirmarDotacion}>
          <input type="hidden" name="id" value={dot.id} />
          <p className="hint">Te la entregaron el {fecha(dot.entregado_en!)}. ¿La tienes?</p>
          <button className="btn primario ancho grande">Sí, la he recibido</button>
        </form>}
        {dot.estado === "recibida" && <p className="hint">Recibida el {fecha(dot.recibido_en!)}.</p>}
      </>}
    </section>

    <section className="panel">
      <h2>Mis tallas</h2>
      <p className="hint">Con ellas tu responsable prepara tu ropa. Cámbialas cuando quieras.</p>
      <FormTallas tallas={tallas} volver="/ropa?ver=mia" />
    </section>

    <section className="panel">
      <details>
        <summary><h2 className="en-linea">¿Se te ha roto algo o no es tu talla?</h2></summary>
        <QuienAprueba permiso="ropa.gestionar" que="cambios" />
        <form action={pedirRopa}>
          <p className="hint">Pon cuántas necesitas de cada prenda y su talla. Lo que dejes en 0 no se pide.</p>
          <div className="tabla-ropa">
            {Object.entries(PRENDAS).map(([id, p]) => <div key={id} className="fila-ropa">
              <span className="fila-ropa-nombre">{p.nombre}</span>
              {p.tallas.length > 1
                ? <select name={`talla_${id}`} aria-label={`Talla de ${p.nombre}`} defaultValue={tallaDe(id, tallas) ?? ""}>
                    <option value="">Talla</option>{p.tallas.map((x) => <option key={x} value={x}>{x}</option>)}
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
            {MOTIVOS_CAMBIO.map((v) => <option key={v} value={v}>{MOTIVOS_ROPA[v]}</option>)}
          </select>
          <label htmlFor="ropa-nota">Algo más (opcional)</label>
          <input id="ropa-nota" name="nota" maxLength={500} placeholder="Ej.: el pantalón tiene la rodilla rota" />
          <button className="btn primario ancho grande" style={{ marginTop: 18 }}>Pedir el cambio</button>
        </form>
      </details>
    </section>

    {(mias ?? []).length > 0 && <section className="panel">
      <h2>Mis cambios</h2>
      <ul className="lista-incidencias">
        {(mias ?? []).map((s) => <li key={s.id}>
          <div><b>{fecha(s.creado)}</b> <Etiqueta estado={s.estado} /></div>
          <ul className="lista-ropa">{s.prendas.map((l, i) => <li key={i}>{textoLinea(l)}</li>)}</ul>
          {s.comentario && <p className="hint"><b>Tu responsable:</b> {s.comentario}</p>}
          {s.entregado_en && <p className="hint">Entregado el {fecha(s.entregado_en)}.</p>}
          {s.estado === "pendiente" && <form action={anularRopa}>
            <input type="hidden" name="id" value={s.id} />
            <button className="btn pequeno">Anular</button>
          </form>}
        </li>)}
      </ul>
    </section>}
  </>;
}

/* ---------------------------------------------------------------- el responsable: la temporada de su gente */
async function Temporada({ uid, esAdmin, temporada, centro, todas }: { uid: string; esAdmin: boolean; temporada: string; centro?: string; todas: boolean }) {
  const { supabase } = await conPermiso("ropa.gestionar");
  const centros = await centrosConPermiso(supabase, uid, esAdmin, ["ropa.gestionar"]);
  const { data } = await supabase.from("ropa_dotaciones").select("id,usuario_id,prendas,estado,entregado_en,recibido_en")
    .eq("temporada", temporada).neq("usuario_id", uid).limit(2000).returns<Dotacion[]>();
  const dotaciones = data ?? [];
  const ids = dotaciones.map((d) => d.usuario_id);
  const [{ data: gente }, { data: tallasFilas }] = ids.length ? await Promise.all([
    supabase.from("usuarios").select("id,nombre,codigo,email,usuario_perfil(centro_id)").in("id", ids).returns<Persona[]>(),
    supabase.from("tallas_ropa").select("usuario_id,tallas").in("usuario_id", ids).returns<{ usuario_id: string; tallas: Tallas }[]>(),
  ]) : [{ data: [] as Persona[] }, { data: [] as { usuario_id: string; tallas: Tallas }[] }];
  const persona = new Map((gente ?? []).map((p) => [p.id, p]));
  const tallasDe = new Map((tallasFilas ?? []).map((x) => [x.usuario_id, x.tallas]));
  const nombreCentro = new Map(centros.map((c) => [c.id, c.nombre]));
  const centroDe = (id: string) => persona.get(id)?.usuario_perfil.map((x) => x.centro_id).find((c) => c !== null) ?? null;
  const filtroCentro = Number(centro) || null;
  const delCentro = dotaciones.filter((d) => !filtroCentro || centroDe(d.usuario_id) === filtroCentro);
  const visibles = delCentro.filter((d) => todas || d.estado !== "recibida")
    .sort((a, b) => (persona.get(a.usuario_id)?.nombre ?? "").localeCompare(persona.get(b.usuario_id)?.nombre ?? ""));
  const n = (e: string) => delCentro.filter((d) => d.estado === e).length;
  const sinTallas = delCentro.filter((d) => d.estado === "por_entregar" && tallasQueFaltan(d.prendas, tallasDe.get(d.usuario_id)).length > 0);

  // Qué preparar: unidades de cada prenda y talla de lo que falta por entregar.
  const preparar = new Map<string, number>();
  for (const d of delCentro.filter((x) => x.estado === "por_entregar")) {
    for (const l of d.prendas) {
      const clave = `${l.prenda}|${tallaDe(l.prenda, tallasDe.get(d.usuario_id)) ?? "?"}`;
      preparar.set(clave, (preparar.get(clave) ?? 0) + l.cantidad);
    }
  }
  const lineasPreparar = [...preparar.entries()].map(([k, cantidad]) => {
    const [prenda, talla] = k.split("|");
    return { prenda, talla, cantidad };
  }).sort((a, b) => a.prenda.localeCompare(b.prenda) || (PRENDAS[a.prenda]?.tallas.indexOf(a.talla) ?? 0) - (PRENDAS[b.prenda]?.tallas.indexOf(b.talla) ?? 0));
  const enlace = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams({ ver: "temporada", ...(filtroCentro ? { centro: String(filtroCentro) } : {}), ...(todas ? { todas: "1" } : {}) });
    for (const [k, v] of Object.entries(extra)) if (v === undefined) q.delete(k); else q.set(k, v);
    return `/ropa?${q}`;
  };
  const volver = "/ropa?ver=temporada";

  return <>
    <div className="cm-cifras ropa-cifras">
      <div className="cm-cifra"><span className="cm-cifra-titulo">Personas</span><strong>{delCentro.length}</strong>
        <span className="cm-cifra-detalle">Con ropa de {nombreTemporada(temporada)}</span></div>
      <div className={`cm-cifra ${n("por_entregar") ? "atencion" : "bien"}`}><span className="cm-cifra-titulo">Por entregar</span>
        <strong>{n("por_entregar")}</strong><span className="cm-cifra-detalle">{sinTallas.length} sin tallas apuntadas</span></div>
      <div className="cm-cifra"><span className="cm-cifra-titulo">Sin confirmar</span><strong>{n("entregada")}</strong>
        <span className="cm-cifra-detalle">Entregadas; falta que lo confirmen</span></div>
      <div className="cm-cifra bien"><span className="cm-cifra-titulo">Recibidas</span><strong>{n("recibida")}</strong>
        <span className="cm-cifra-detalle">Confirmadas por la persona</span></div>
    </div>

    <form className="filtros" method="get" action="/ropa">
      <input type="hidden" name="ver" value="temporada" />
      <div><label htmlFor="f-centro">Centro</label>
        <select id="f-centro" name="centro" defaultValue={filtroCentro ?? ""}>
          <option value="">Todos mis centros</option>{centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select></div>
      <label className="chips"><span><input type="checkbox" name="todas" value="1" defaultChecked={todas} /> Ver también las ya recibidas</span></label>
      <button className="btn">Filtrar</button>
    </form>

    <div className="cm-dos ropa-dos">
      <section className="panel">
        <h2>Qué preparar</h2>
        {lineasPreparar.length === 0 ? <p className="hint">No queda nada por entregar.</p> : <table className="cm-tabla">
          <thead><tr><th>Prenda</th><th>Talla</th><th>Unidades</th></tr></thead>
          <tbody>{lineasPreparar.map((l) => <tr key={`${l.prenda}${l.talla}`}>
            <td>{PRENDAS[l.prenda]?.nombre ?? l.prenda}</td>
            <td>{l.talla === "?" ? <span className="etiqueta pronto">Sin talla</span> : l.talla}</td><td><b>{l.cantidad}</b></td>
          </tr>)}</tbody>
        </table>}
        <p className="hint">Para hacer el pedido al proveedor: suma de lo que falta por entregar{filtroCentro ? " en este centro" : ""}.</p>
      </section>
      <section className="panel">
        <h2>Composición</h2>
        <p className="hint">Cada puesto recibe dos mudas completas por temporada. Verano: del 1 de abril al 30 de septiembre;
          invierno: del 1 de octubre al 31 de marzo. Lo que lleva cada muda se decide en «Composición».</p>
        {sinTallas.length > 0 && <p className="aviso">{sinTallas.length} {sinTallas.length === 1 ? "persona no tiene" : "personas no tienen"} sus
          tallas. Pueden apuntarlas en su móvil o puedes hacerlo tú desde la lista.</p>}
      </section>
    </div>

    <section className="panel">
      <div className="ropa-lista-cabecera"><h2>Entregas ({visibles.length})</h2>
        {!todas && n("recibida") > 0 && <Link href={enlace({ todas: "1" })} className="cm-enlace">Ver también las {n("recibida")} recibidas</Link>}</div>
      {visibles.length === 0 ? <p className="hint">Nada por aquí.</p> : <ul className="ropa-personas">
        {visibles.map((d) => {
          const p = persona.get(d.usuario_id);
          const tallas = tallasDe.get(d.usuario_id) ?? null;
          const faltan = tallasQueFaltan(d.prendas, tallas);
          const c = centroDe(d.usuario_id);
          return <li key={d.id}>
            <div className="ropa-persona-nombre"><b>{p?.nombre || p?.codigo || p?.email || "—"}</b>
              <span className="hint">{c ? nombreCentro.get(c) ?? "" : "Sin centro"}</span></div>
            <div className="ropa-persona-ropa">{d.prendas.map((l) => <span key={l.prenda}>{textoKit(l, tallas)}</span>)}</div>
            <div className="ropa-persona-accion">
              <span className={`etiqueta ${CLASE_DOTACION[d.estado]}`}>{d.estado === "entregada" ? "Sin confirmar" : ESTADO_DOTACION[d.estado]}</span>
              {d.estado === "por_entregar" && <form action={entregarDotacion}>
                <input type="hidden" name="id" value={d.id} /><input type="hidden" name="volver" value={volver} />
                <button className="btn pequeno primario" disabled={faltan.length > 0} title={faltan.length ? "Primero apunta sus tallas" : undefined}>Entregada</button>
              </form>}
              {d.estado === "entregada" && <form action={entregarDotacion}>
                <input type="hidden" name="id" value={d.id} /><input type="hidden" name="deshacer" value="1" /><input type="hidden" name="volver" value={volver} />
                <button className="btn pequeno">Deshacer</button>
              </form>}
            </div>
            {d.estado === "por_entregar" && <details className="ropa-persona-tallas" open={faltan.length > 0 && visibles.length <= 5}>
              <summary>{faltan.length ? "Apuntar sus tallas" : "Cambiar sus tallas"}</summary>
              <FormTallas tallas={tallas} usuario={d.usuario_id} volver={volver} boton="Guardar tallas" />
            </details>}
          </li>;
        })}
      </ul>}
    </section>
  </>;
}

/* ---------------------------------------------------------------- el responsable: cambios por rotura, talla o pérdida */
async function Cambios({ uid }: { uid: string }) {
  const { supabase } = await conPermiso("ropa.gestionar");
  // La base de datos solo devuelve las de las personas de sus centros (todas, si es superadministrador).
  const { data: equipo } = await supabase.from("solicitudes_ropa").select(CAMPOS).neq("usuario_id", uid).in("estado", ["pendiente", "aprobada"])
    .order("creado").limit(200).returns<Solicitud[]>();
  const ids = [...new Set((equipo ?? []).map((s) => s.usuario_id))];
  const { data: personas } = ids.length
    ? await supabase.from("usuarios").select("id,nombre,email,codigo").in("id", ids)
      .returns<{ id: string; nombre: string; email: string | null; codigo: string | null }[]>()
    : { data: [] };
  const nombre = new Map((personas ?? []).map((p) => [p.id, p.nombre || p.codigo || p.email || "—"]));
  const pendientes = (equipo ?? []).filter((s) => s.estado === "pendiente");
  const porEntregar = (equipo ?? []).filter((s) => s.estado === "aprobada");
  return <div className="cm-dos">
    <section className="panel">
      <h2>Por aprobar ({pendientes.length})</h2>
      {pendientes.length === 0 ? <p className="hint">No hay cambios esperando.</p> : <ul className="lista-incidencias">
        {pendientes.map((s) => <li key={s.id}>
          <div><b>{nombre.get(s.usuario_id) ?? "—"}</b> <span className="hint">· {fecha(s.creado)} · {MOTIVOS_ROPA[s.motivo] ?? s.motivo}</span></div>
          <ul className="lista-ropa">{s.prendas.map((l, i) => <li key={i}>{textoLinea(l)}</li>)}</ul>
          {s.nota && <p className="hint">«{s.nota}»</p>}
          <form action={resolverRopa} className="fila-form">
            <SinEnvioConIntro />
            <input type="hidden" name="id" value={s.id} />
            <div className="crece"><label htmlFor={`com-${s.id}`}>Comentario (obligatorio si lo rechazas)</label>
              <input id={`com-${s.id}`} name="comentario" maxLength={300} /></div>
            <button className="btn primario" name="decision" value="aprobar">Aprobar</button>
            <button className="btn" name="decision" value="rechazar">Rechazar</button>
          </form>
        </li>)}
      </ul>}
    </section>
    <section className="panel">
      <h2>Aprobados, por entregar ({porEntregar.length})</h2>
      {porEntregar.length === 0 ? <p className="hint">Nada por entregar.</p> : <ul className="lista-incidencias">
        {porEntregar.map((s) => <li key={s.id}>
          <div><b>{nombre.get(s.usuario_id) ?? "—"}</b> <span className="hint">· pedido el {fecha(s.creado)}</span></div>
          <ul className="lista-ropa">{s.prendas.map((l, i) => <li key={i}>{textoLinea(l)}</li>)}</ul>
          <form action={entregarRopa}>
            <input type="hidden" name="id" value={s.id} />
            <button className="btn pequeno">Marcar como entregado</button>
          </form>
        </li>)}
      </ul>}
    </section>
  </div>;
}

/* ---------------------------------------------------------------- composición de la muda de cada puesto */
async function Composicion() {
  const { supabase } = await conPermiso("ropa.configurar");
  const [{ data: perfiles }, { data: kits }] = await Promise.all([
    supabase.from("perfiles").select("id,nombre,pantalla").order("nombre").returns<{ id: number; nombre: string; pantalla: string | null }[]>(),
    supabase.from("ropa_kits").select("perfil_id,temporada,prendas,mudas").returns<Kit[]>(),
  ]);
  // Primero los puestos del móvil (chóferes y operarios), que son los que llevan ropa; luego el resto.
  const lista = (perfiles ?? []).sort((a, b) => Number(b.pantalla === "campo") - Number(a.pantalla === "campo") || a.nombre.localeCompare(b.nombre));
  const kitDe = (perfil: number, temporada: string) => (kits ?? []).find((k) => k.perfil_id === perfil && k.temporada === temporada);
  return <>
    <p className="hint">Marca cuántas unidades de cada prenda lleva <b>una muda</b> y cuántas mudas tocan por temporada. Al guardar, las
      dotaciones que aún no se han entregado se ajustan solas; las ya entregadas no cambian.</p>
    {lista.map((p) => <details key={p.id} className="perfil" open={p.pantalla === "campo"}>
      <summary><b>{p.nombre}</b> <span className="hint">· {["verano", "invierno"].map((t) => {
        const k = kitDe(p.id, t);
        return `${t}: ${k && k.prendas.length && k.mudas ? `${k.mudas} mudas` : "sin ropa"}`;
      }).join(" · ")}</span></summary>
      <div className="cm-dos">
        {(["verano", "invierno"] as const).map((t) => {
          const k = kitDe(p.id, t);
          return <form key={t} action={guardarKit} className="cm-panel">
            <input type="hidden" name="perfil" value={p.id} /><input type="hidden" name="temporada" value={t} />
            <input type="hidden" name="volver" value="/ropa?ver=composicion" />
            <h3>{t === "verano" ? "Verano (abril–septiembre)" : "Invierno (octubre–marzo)"}</h3>
            <div className="tabla-ropa">
              {Object.entries(PRENDAS).map(([id, prenda]) => <div key={id} className="fila-ropa kit">
                <span className="fila-ropa-nombre">{prenda.nombre}</span>
                <select name={`kit_${id}`} aria-label={`${prenda.nombre} por muda`} defaultValue={String(k?.prendas.find((l) => l.prenda === id)?.cantidad ?? 0)}>
                  {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>)}
            </div>
            <label htmlFor={`mudas-${p.id}-${t}`}>Mudas por temporada</label>
            <select id={`mudas-${p.id}-${t}`} name="mudas" defaultValue={String(k?.mudas ?? 2)}>
              {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button className="btn primario ancho" style={{ marginTop: 14 }}>Guardar {t}</button>
          </form>;
        })}
      </div>
    </details>)}
  </>;
}
