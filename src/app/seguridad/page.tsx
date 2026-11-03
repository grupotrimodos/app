import Link from "next/link";
import Cabecera from "../Cabecera";
import Icono from "../Icono";
import { fecha, hora, hoyISO } from "@/lib/jornada";
import {
  caducidad, CLASE_CADUCIDAD, DOCUMENTOS_VEHICULO, ESTADO_INCIDENCIA, estadoDocumento, fechaLarga, GRAVEDAD, NOMBRE_CADUCIDAD,
  RESULTADO_REVISION, SIN_CADUCIDAD, situacionDocumentos, TIPOS_EQUIPO, TIPOS_INCIDENCIA, TIPOS_REVISION,
  type Caducidad, type Documento,
} from "@/lib/seguridad";
import { conPermiso } from "@/lib/usuario";
import {
  anotarInspeccion, anotarRevision, crearEquipo, guardarDocumentoPersona, guardarDocumentoVehiculo, seguirIncidencia,
} from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Seguridad · Grupo Trimodos" };

const PESTANAS = [
  ["resumen", "Resumen"], ["vehiculos", "Vehículos"], ["personas", "Personas"], ["almacenes", "Carretillas y almacenes"],
  ["incidencias", "Incidencias"],
] as const;

type Vehiculo = { id: number; matricula: string; modelo: string | null };
type Usuario = { id: string; nombre: string; email: string | null; codigo: string | null; activo: boolean };
type Equipo = { id: number; tipo: string; nombre: string; marca_modelo: string | null; centro_id: number | null; proxima_revision: string | null; activo: boolean };
type Revision = { equipo_id: number; fecha: string; tipo: string; resultado: string };
type Inspeccion = { id: number; centro_id: number | null; lugar: string | null; fecha: string; resultado: string; deficiencias: string | null; proxima: string | null };
type Incidencia = {
  id: number; reportado_por: string; ocurrio: string; tipo: string; gravedad: string; lugar: string | null; vehiculo_id: number | null;
  descripcion: string; estado: string; medidas: string | null;
};

/** Orden de urgencia: primero lo caducado, luego lo que falta y lo que caduca pronto. */
const PESO: Record<Caducidad, number> = { caducado: 0, falta: 1, pronto: 2, al_dia: 3 };

function Estado({ estado, caduca, sinFecha = "Sin fecha" }: { estado: Caducidad; caduca?: string | null; sinFecha?: string }) {
  return <span className={`etiqueta ${CLASE_CADUCIDAD[estado]}`}>
    {estado === "falta" ? sinFecha : `${NOMBRE_CADUCIDAD[estado]}${caduca ? ` · ${fechaLarga(caduca)}` : ""}`}
  </span>;
}

/** Formulario corto de un documento (fecha y número), para un camión o una persona. */
function FormDocumento({ accion, campo, valor, tipo, nombre, doc }: {
  accion: (f: FormData) => Promise<void>; campo: "vehiculo" | "usuario"; valor: string | number; tipo: string; nombre: string;
  doc: Documento | null | undefined;
}) {
  const id = `${campo}-${valor}-${tipo}`;
  return <form action={accion} className="fila-form documento-form">
    <input type="hidden" name={campo} value={valor} />
    <input type="hidden" name="tipo" value={tipo} />
    <div><label htmlFor={`c-${id}`}>{nombre}: caduca el</label>
      <input id={`c-${id}`} type="date" name="caduca" defaultValue={doc?.caduca ?? ""} required={!SIN_CADUCIDAD.has(tipo)} /></div>
    <div><label htmlFor={`n-${id}`}>Número</label><input id={`n-${id}`} name="numero" defaultValue={doc?.numero ?? ""} maxLength={60} /></div>
    <button className="btn pequeno">Guardar</button>
  </form>;
}

export default async function Seguridad({ searchParams }: { searchParams: Promise<{ ver?: string; ok?: string; error?: string }> }) {
  const { supabase, perfil, veArea, puede } = await conPermiso("seguridad.ver", "seguridad.gestionar", "vehiculos.gestionar");
  const { ver: pedida, ok, error } = await searchParams;
  const veTodo = puede("seguridad.ver", "seguridad.gestionar");
  const gestiona = puede("seguridad.gestionar");
  const editaVehiculos = puede("seguridad.gestionar", "vehiculos.gestionar");
  // Quien solo gestiona camiones ve únicamente su documentación (ITV, seguro, tacógrafo).
  const pestanas = PESTANAS.filter(([id]) => veTodo || id === "vehiculos");
  const ver = pestanas.find(([id]) => id === pedida)?.[0] ?? pestanas[0][0];
  const hoy = hoyISO();

  const [vehiculosR, documentosR, usuariosR, perfilesR, equiposR, revisionesR, inspeccionesR, incidenciasR, centrosR] = await Promise.all([
    supabase.from("vehiculos").select("id,matricula,modelo").eq("activo", true).order("matricula").returns<Vehiculo[]>(),
    supabase.from("documentos").select("id,usuario_id,vehiculo_id,tipo,numero,caduca").returns<Documento[]>(),
    veTodo ? supabase.from("usuarios").select("id,nombre,email,codigo,activo").returns<Usuario[]>() : null,
    veTodo ? supabase.from("usuario_perfil").select("usuario_id,perfiles(documentos)") : null,
    veTodo ? supabase.from("equipos").select("id,tipo,nombre,marca_modelo,centro_id,proxima_revision,activo").order("tipo").order("nombre").returns<Equipo[]>() : null,
    veTodo ? supabase.from("equipo_revisiones").select("equipo_id,fecha,tipo,resultado").order("fecha", { ascending: false }).limit(300).returns<Revision[]>() : null,
    veTodo ? supabase.from("inspecciones").select("id,centro_id,lugar,fecha,resultado,deficiencias,proxima").order("fecha", { ascending: false }).limit(50).returns<Inspeccion[]>() : null,
    veTodo ? supabase.from("incidencias").select("id,reportado_por,ocurrio,tipo,gravedad,lugar,vehiculo_id,descripcion,estado,medidas")
      .order("creado", { ascending: false }).limit(100).returns<Incidencia[]>() : null,
    supabase.from("centros").select("id,nombre").order("nombre").returns<{ id: number; nombre: string }[]>(),
  ]);
  const vehiculos = vehiculosR.data ?? [];
  const documentos = documentosR.data ?? [];
  const usuarios = usuariosR?.data ?? [];
  const equipos = equiposR?.data ?? [];
  const inspecciones = inspeccionesR?.data ?? [];
  const incidencias = incidenciasR?.data ?? [];
  const centros = centrosR.data ?? [];
  const nombreCentro = new Map(centros.map((c) => [c.id, c.nombre]));
  const nombreUsuario = new Map(usuarios.map((u) => [u.id, u.nombre || u.email || u.codigo || "—"]));
  const matricula = new Map(vehiculos.map((v) => [v.id, v.matricula]));

  // Vehículos: los tres documentos de cada camión activo.
  const docVehiculo = new Map(documentos.filter((d) => d.vehiculo_id).map((d) => [`${d.vehiculo_id}:${d.tipo}`, d]));
  const filasVehiculos = vehiculos.map((v) => ({
    v, docs: Object.entries(DOCUMENTOS_VEHICULO).map(([tipo, nombre]) => {
      const doc = docVehiculo.get(`${v.id}:${tipo}`) ?? null;
      return { tipo, nombre, doc, estado: estadoDocumento(doc, hoy) };
    }),
  }));

  // Personas: la documentación que pide su puesto (la suma de sus perfiles), solo de las activas que tienen alguna.
  const obligatorios = new Map<string, Set<string>>();
  for (const f of (perfilesR?.data ?? []) as unknown as { usuario_id: string; perfiles: { documentos: string[] } | null }[]) {
    for (const t of f.perfiles?.documentos ?? []) obligatorios.set(f.usuario_id, (obligatorios.get(f.usuario_id) ?? new Set()).add(t));
  }
  const filasPersonas = usuarios.filter((u) => u.activo && obligatorios.get(u.id)?.size).map((u) => ({
    u, situacion: situacionDocumentos([...obligatorios.get(u.id)!], documentos.filter((d) => d.usuario_id === u.id), hoy),
  })).sort((a, b) => (nombreUsuario.get(a.u.id) ?? "").localeCompare(nombreUsuario.get(b.u.id) ?? ""));

  // Equipos: última revisión y si la próxima está al día.
  const ultimaRevision = new Map<number, Revision>();
  for (const r of revisionesR?.data ?? []) if (!ultimaRevision.has(r.equipo_id)) ultimaRevision.set(r.equipo_id, r);

  // Lo urgente, de todo el panel, en una sola lista.
  const urgente = [
    ...filasVehiculos.flatMap(({ v, docs }) => docs.filter((d) => d.estado !== "al_dia")
      .map((d) => ({ que: `${d.nombre} · ${v.matricula}`, estado: d.estado, caduca: d.doc?.caduca ?? null, ver: "vehiculos" }))),
    ...filasPersonas.flatMap(({ u, situacion }) => situacion.filter((s) => s.estado !== "al_dia")
      .map((s) => ({ que: `${s.nombre} · ${nombreUsuario.get(u.id)}`, estado: s.estado, caduca: s.doc?.caduca ?? null, ver: "personas" }))),
    ...equipos.filter((e) => e.activo).map((e) => ({ e, estado: caducidad(e.proxima_revision, hoy) })).filter((x) => x.estado !== "al_dia")
      .map(({ e, estado }) => ({ que: `Revisión · ${TIPOS_EQUIPO[e.tipo] ?? e.tipo} ${e.nombre}`, estado, caduca: e.proxima_revision, ver: "almacenes" })),
  ].sort((a, b) => PESO[a.estado] - PESO[b.estado] || (a.caduca ?? "").localeCompare(b.caduca ?? ""));
  const abiertas = incidencias.filter((i) => i.estado !== "cerrada");
  const cuenta = (e: Caducidad) => urgente.filter((u) => u.estado === e).length;

  return <>
    <Cabecera nombre={perfil.nombre || perfil.email || perfil.codigo || ""} admin={veArea("admin")} />
    <main className="contenido">
      <h1>Seguridad</h1>
      <p className="lead">Caducidades de vehículos y personas, carretillas, inspecciones de almacén e incidencias. Se avisa 30 días antes.</p>
      {ok && <p className="aviso" role="status">{ok}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {pestanas.length > 1 && <nav className="pestanas" aria-label="Apartados de seguridad">
        {pestanas.map(([id, nombre]) => <Link key={id} href={`/seguridad?ver=${id}`} className={id === ver ? "activa" : ""}
          aria-current={id === ver ? "page" : undefined}>{nombre}{id === "incidencias" && abiertas.length ? ` (${abiertas.length})` : ""}</Link>)}
      </nav>}

      {ver === "resumen" && <>
        <div className="inicio-kpis">
          <Link className={`inicio-kpi ${cuenta("caducado") ? "atencion" : ""}`} href="#urgente"><span className="inicio-kpi-titulo"><Icono nombre="aviso" size={18} />Caducados</span>
            <strong>{cuenta("caducado")}</strong><span className="hint">Documentos y revisiones vencidos</span></Link>
          <Link className={`inicio-kpi ${cuenta("falta") ? "atencion" : ""}`} href="#urgente"><span className="inicio-kpi-titulo"><Icono nombre="documento" size={18} />Sin apuntar</span>
            <strong>{cuenta("falta")}</strong><span className="hint">Documentos que nadie ha rellenado</span></Link>
          <Link className="inicio-kpi" href="#urgente"><span className="inicio-kpi-titulo"><Icono nombre="calendario" size={18} />Caducan en 30 días</span>
            <strong>{cuenta("pronto")}</strong><span className="hint">Para ir renovando</span></Link>
          <Link className={`inicio-kpi ${abiertas.length ? "atencion" : ""}`} href="/seguridad?ver=incidencias"><span className="inicio-kpi-titulo"><Icono nombre="escudo" size={18} />Incidencias abiertas</span>
            <strong>{abiertas.length}</strong><span className="hint">{abiertas.filter((i) => i.gravedad !== "leve").length} graves o muy graves</span></Link>
        </div>
        <section className="panel" id="urgente">
          <h2>Lo urgente</h2>
          {urgente.length === 0 ? <p className="hint">Todo está al día.</p> : <table>
            <thead><tr><th>Qué</th><th>Estado</th><th /></tr></thead>
            <tbody>{urgente.slice(0, 40).map((u, i) => <tr key={i}>
              <td>{u.que}</td><td><Estado estado={u.estado} caduca={u.caduca} sinFecha="Sin apuntar" /></td>
              <td><Link href={`/seguridad?ver=${u.ver}`}>Ver</Link></td>
            </tr>)}</tbody>
          </table>}
          {urgente.length > 40 && <p className="hint">Y {urgente.length - 40} más.</p>}
        </section>
      </>}

      {ver === "vehiculos" && <section className="panel">
        <h2>Documentación de los camiones</h2>
        {filasVehiculos.length === 0 ? <p className="hint">No hay camiones activos. Se dan de alta en Administración.</p> : <table>
          <thead><tr><th>Matrícula</th>{Object.values(DOCUMENTOS_VEHICULO).map((n) => <th key={n}>{n}</th>)}</tr></thead>
          <tbody>{filasVehiculos.map(({ v, docs }) => <tr key={v.id}>
            <td><b>{v.matricula}</b>{v.modelo && <div className="hint">{v.modelo}</div>}</td>
            {docs.map((d) => <td key={d.tipo}><Estado estado={d.estado} caduca={d.doc?.caduca} sinFecha="Sin apuntar" /></td>)}
          </tr>)}</tbody>
        </table>}
        {editaVehiculos && filasVehiculos.map(({ v, docs }) => <details key={v.id} className="perfil">
          <summary><b>{v.matricula}</b> <span className="hint">· apuntar ITV, seguro y tacógrafo</span></summary>
          {docs.map((d) => <FormDocumento key={d.tipo} accion={guardarDocumentoVehiculo} campo="vehiculo" valor={v.id} tipo={d.tipo} nombre={d.nombre} doc={d.doc} />)}
        </details>)}
      </section>}

      {ver === "personas" && <section className="panel">
        <h2>Documentación de las personas</h2>
        <p className="hint">Cada uno la rellena desde «Mi documentación» y le avisamos en su inicio de lo que le falta. Lo que pide cada
          puesto se elige en Administración → Perfiles.</p>
        {filasPersonas.length === 0 ? <p className="hint">Ninguna persona activa tiene un perfil que pida documentación.</p> : filasPersonas.map(({ u, situacion }) => {
          const peor = situacion.reduce<Caducidad>((p, s) => (PESO[s.estado] < PESO[p] ? s.estado : p), "al_dia");
          return <details key={u.id} className="perfil">
            <summary><b>{nombreUsuario.get(u.id)}</b>{u.codigo && <span className="hint"> · código {u.codigo}</span>}{" "}
              <span className={`etiqueta ${CLASE_CADUCIDAD[peor]}`}>{peor === "al_dia" ? "Al día" : `${situacion.filter((s) => s.estado !== "al_dia").length} por poner al día`}</span></summary>
            <ul className="lista-documentos">{situacion.map((s) => <li key={s.tipo}>{s.nombre} <Estado estado={s.estado} caduca={s.doc?.caduca} sinFecha="Falta" /></li>)}</ul>
            {gestiona && situacion.map((s) => <FormDocumento key={s.tipo} accion={guardarDocumentoPersona} campo="usuario" valor={u.id} tipo={s.tipo} nombre={s.nombre} doc={s.doc} />)}
          </details>;
        })}
      </section>}

      {ver === "almacenes" && <>
        <section className="panel">
          <h2>Carretillas y traspaletas</h2>
          {equipos.length === 0 ? <p className="hint">Todavía no hay equipos. Añádelos abajo.</p> : <table>
            <thead><tr><th>Equipo</th><th>Centro</th><th>Última revisión</th><th>Próxima revisión</th></tr></thead>
            <tbody>{equipos.map((e) => {
              const r = ultimaRevision.get(e.id);
              return <tr key={e.id}>
                <td><b>{TIPOS_EQUIPO[e.tipo] ?? e.tipo} {e.nombre}</b>{e.marca_modelo && <div className="hint">{e.marca_modelo}</div>}
                  {!e.activo && <span className="etiqueta mal">Fuera de servicio</span>}</td>
                <td>{e.centro_id ? nombreCentro.get(e.centro_id) : "—"}</td>
                <td>{r ? <>{fechaLarga(r.fecha)}<div className="hint">{TIPOS_REVISION[r.tipo]} · {RESULTADO_REVISION[r.resultado]}</div></> : <span className="hint">Ninguna</span>}</td>
                <td><Estado estado={caducidad(e.proxima_revision, hoy)} caduca={e.proxima_revision} /></td>
              </tr>;
            })}</tbody>
          </table>}
          {gestiona && equipos.map((e) => <details key={e.id} className="perfil">
            <summary><b>{TIPOS_EQUIPO[e.tipo] ?? e.tipo} {e.nombre}</b> <span className="hint">· anotar revisión, mantenimiento o avería</span></summary>
            <form action={anotarRevision}>
              <input type="hidden" name="equipo" value={e.id} />
              <div className="fila-form">
                <div><label htmlFor={`rf-${e.id}`}>Fecha</label><input id={`rf-${e.id}`} type="date" name="fecha" defaultValue={hoy} required /></div>
                <div><label htmlFor={`rt-${e.id}`}>Qué</label><select id={`rt-${e.id}`} name="tipo">
                  {Object.entries(TIPOS_REVISION).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
                <div><label htmlFor={`rr-${e.id}`}>Resultado</label><select id={`rr-${e.id}`} name="resultado">
                  {Object.entries(RESULTADO_REVISION).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
                <div><label htmlFor={`rp-${e.id}`}>Próxima revisión</label><input id={`rp-${e.id}`} type="date" name="proxima_revision" /></div>
              </div>
              <label htmlFor={`rn-${e.id}`}>Notas</label><input id={`rn-${e.id}`} name="nota" maxLength={500} />
              {!e.activo && <label className="chips"><span><input type="checkbox" name="reactivar" /> Vuelve a estar en servicio (si el resultado es correcto)</span></label>}
              <button className="btn primario" style={{ marginTop: 12 }}>Anotar</button>
            </form>
          </details>)}
          {gestiona && <details className="perfil">
            <summary><b>+ Añadir carretilla o traspaleta</b></summary>
            <form action={crearEquipo}>
              <div className="fila-form">
                <div><label htmlFor="eq-tipo">Tipo</label><select id="eq-tipo" name="tipo">
                  {Object.entries(TIPOS_EQUIPO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
                <div><label htmlFor="eq-nombre">Número o nombre</label><input id="eq-nombre" name="nombre" required maxLength={60} placeholder="Ej.: C-03" /></div>
                <div><label htmlFor="eq-marca">Marca y modelo</label><input id="eq-marca" name="marca_modelo" maxLength={80} /></div>
                <div><label htmlFor="eq-centro">Centro</label><select id="eq-centro" name="centro" defaultValue="">
                  <option value="">Sin centro</option>{centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
                <div><label htmlFor="eq-proxima">Próxima revisión</label><input id="eq-proxima" type="date" name="proxima_revision" /></div>
              </div>
              <button className="btn primario" style={{ marginTop: 12 }}>Añadir equipo</button>
            </form>
          </details>}
        </section>

        <section className="panel">
          <h2>Inspecciones de seguridad de almacén</h2>
          {inspecciones.length === 0 ? <p className="hint">Todavía no hay inspecciones anotadas.</p> : <table>
            <thead><tr><th>Almacén</th><th>Fecha</th><th>Resultado</th><th>Próxima</th></tr></thead>
            <tbody>{inspecciones.map((i) => <tr key={i.id}>
              <td>{i.centro_id ? nombreCentro.get(i.centro_id) : i.lugar}</td><td>{fechaLarga(i.fecha)}</td>
              <td><span className={`etiqueta ${i.resultado === "correcta" ? "ok" : "mal"}`}>{i.resultado === "correcta" ? "Correcta" : "Con deficiencias"}</span>
                {i.deficiencias && <div className="hint">{i.deficiencias}</div>}</td>
              <td>{i.proxima ? <Estado estado={caducidad(i.proxima, hoy)} caduca={i.proxima} /> : "—"}</td>
            </tr>)}</tbody>
          </table>}
          {gestiona && <details className="perfil">
            <summary><b>+ Anotar una inspección</b></summary>
            <form action={anotarInspeccion}>
              <div className="fila-form">
                {centros.length > 0 && <div><label htmlFor="in-centro">Centro</label><select id="in-centro" name="centro" defaultValue="">
                  <option value="">Otro lugar…</option>{centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>}
                <div><label htmlFor="in-lugar">{centros.length ? "U otro lugar" : "Almacén o lugar"}</label><input id="in-lugar" name="lugar" maxLength={80} /></div>
                <div><label htmlFor="in-fecha">Fecha</label><input id="in-fecha" type="date" name="fecha" defaultValue={hoy} required /></div>
                <div><label htmlFor="in-resultado">Resultado</label><select id="in-resultado" name="resultado">
                  <option value="correcta">Correcta</option><option value="con_deficiencias">Con deficiencias</option></select></div>
                <div><label htmlFor="in-proxima">Próxima inspección</label><input id="in-proxima" type="date" name="proxima" /></div>
              </div>
              <label htmlFor="in-def">Deficiencias encontradas</label><textarea id="in-def" name="deficiencias" rows={3} maxLength={1000} />
              <button className="btn primario" style={{ marginTop: 12 }}>Anotar inspección</button>
            </form>
          </details>}
        </section>
      </>}

      {ver === "incidencias" && <section className="panel">
        <h2>Incidencias</h2>
        {incidencias.length === 0 ? <p className="hint">No hay incidencias.</p> : <ul className="lista-incidencias">
          {incidencias.map((i) => <li key={i.id}>
            <div><b>{TIPOS_INCIDENCIA[i.tipo] ?? i.tipo}</b> · <span className={i.gravedad === "leve" ? "" : "texto-mal"}>{GRAVEDAD[i.gravedad] ?? i.gravedad}</span>
              <span className={`etiqueta ${i.estado === "cerrada" ? "ok" : i.estado === "abierta" ? "pronto" : ""}`}>{ESTADO_INCIDENCIA[i.estado] ?? i.estado}</span></div>
            <p className="hint">{fecha(i.ocurrio)}, {hora(i.ocurrio)} · {nombreUsuario.get(i.reportado_por) ?? "—"}
              {i.lugar && ` · ${i.lugar}`}{i.vehiculo_id && matricula.get(i.vehiculo_id) && ` · ${matricula.get(i.vehiculo_id)}`}</p>
            <p>{i.descripcion}</p>
            {gestiona ? <form action={seguirIncidencia} className="fila-form">
              <input type="hidden" name="id" value={i.id} />
              <div><label htmlFor={`ie-${i.id}`}>Estado</label><select id={`ie-${i.id}`} name="estado" defaultValue={i.estado}>
                {Object.entries(ESTADO_INCIDENCIA).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
              <div className="crece"><label htmlFor={`im-${i.id}`}>Medidas tomadas</label><input id={`im-${i.id}`} name="medidas" defaultValue={i.medidas ?? ""} maxLength={2000} /></div>
              <button className="btn pequeno">Guardar</button>
            </form> : i.medidas && <p className="hint"><b>Medidas:</b> {i.medidas}</p>}
          </li>)}
        </ul>}
      </section>}
    </main>
  </>;
}
