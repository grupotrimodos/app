import Link from "next/link";
import SinEnvioConIntro from "../SinEnvioConIntro";
import Cabecera from "../Cabecera";
import EstadoOdoo from "../EstadoOdoo";
import { centrosConPermiso, conPermiso } from "@/lib/usuario";
import { permisosDe } from "@/lib/permisos";
import {
  duracion, estadoDe, fecha, hora, hoyISO, inicioDia, jornadaEnCurso, minutosTrabajados, NOMBRE_AUSENCIA, NOMBRE_ESTADO, NOMBRE_TIPO,
  type Fichaje,
} from "@/lib/jornada";
import { corregirFichaje, reintentarOdoo, resolverAusencia } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi equipo · Grupo Trimodos" };

const NADIE = "00000000-0000-0000-0000-000000000000";
const SIN_CENTRO = 0;   // pestaña del administrador con quien aún no tiene centro
type Fila = { usuario_id: string; perfiles: { nombre: string }; usuarios: { nombre: string; codigo: string | null; activo: boolean } };
type Miembro = { usuario_id: string; perfiles: string[]; usuarios: Fila["usuarios"] };
type Ausencia = { id: number; usuario_id: string; tipo: string; desde: string; hasta: string; motivo: string | null; estado: string;
  odoo_estado: string; odoo_error: string | null };

export default async function PaginaEquipo({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; centro?: string }> }) {
  const { supabase, uid, perfil, puede, veArea } = await conPermiso(...permisosDe("equipo"));
  const conCentro = await centrosConPermiso(supabase, uid, perfil.es_admin, permisosDe("equipo"));
  // El administrador ve también a quien todavía no tiene centro (si no, sus solicitudes no le llegarían a nadie).
  const centros = perfil.es_admin ? [...conCentro, { id: SIN_CENTRO, nombre: "Sin centro" }] : conCentro;
  const verEquipo = puede("equipo.ver"), aprobar = puede("ausencias.aprobar"), corregir = puede("fichaje.corregir");
  const { ok, error, centro } = await searchParams;
  if (centros.length === 0) {
    return <>
      <Cabecera nombre={perfil.nombre || perfil.email || ""} admin={veArea("admin")} />
      <main className="contenido estrecho"><h1>Mi equipo</h1>
        <section className="panel"><p>Tienes el perfil de responsable, pero <b>sin ningún centro asignado</b>, así que todavía no
          tienes a nadie a tu cargo. Pide a la administración que te asigne el perfil en tu centro.</p></section></main>
    </>;
  }
  const elegido = centros.find((c) => String(c.id) === centro) ?? centros[0];

  // Personas con algún perfil en este centro (una persona puede tener varios perfiles).
  const filtro = supabase.from("usuario_perfil").select("usuario_id,perfiles(nombre),usuarios(nombre,codigo,activo)");
  const { data: m } = await (elegido.id === SIN_CENTRO ? filtro.is("centro_id", null) : filtro.eq("centro_id", elegido.id));
  const porPersona = new Map<string, Miembro>();
  for (const x of (m ?? []) as unknown as Fila[]) {
    if (!x.usuarios?.activo) continue;
    const y = porPersona.get(x.usuario_id) ?? { usuario_id: x.usuario_id, perfiles: [], usuarios: x.usuarios };
    if (x.perfiles) y.perfiles.push(x.perfiles.nombre);
    porPersona.set(x.usuario_id, y);
  }
  const miembros = [...porPersona.values()].sort((a, b) => (a.usuarios.nombre || "").localeCompare(b.usuarios.nombre || ""));
  const ids = miembros.map((x) => x.usuario_id);
  const hoy = hoyISO();

  const [{ data: f }, { data: aus }, { data: asig }, { data: porResolver }, { data: sinEnviar }] = await Promise.all([
    supabase.from("fichajes").select("id,usuario_id,tipo,momento,origen,nota,odoo_estado,odoo_error")
      .in("usuario_id", ids.length ? ids : [NADIE]).gte("momento", inicioDia(1).toISOString()).order("momento"),
    supabase.from("ausencias").select("id,usuario_id,tipo,desde,hasta,motivo,estado,odoo_estado,odoo_error")
      .in("usuario_id", ids.length ? ids : [NADIE]).or(`estado.eq.pendiente,and(estado.eq.aprobada,hasta.gte.${hoy})`).order("desde"),
    supabase.from("asignaciones").select("usuario_id,inicio,vehiculos(matricula)")
      .in("usuario_id", ids.length ? ids : [NADIE]).is("fin", null),
    // Por aprobar: TODAS las que puede resolver (la base de datos decide cuáles), sea cual sea el centro elegido.
    aprobar ? supabase.from("ausencias").select("id,usuario_id,tipo,desde,hasta,motivo,estado,odoo_estado,odoo_error")
      .eq("estado", "pendiente").neq("usuario_id", uid).order("desde") : Promise.resolve({ data: [] }),
    // Fichajes que no han llegado a Odoo, sean del día que sean (los siguientes esperan detrás de un error).
    supabase.from("fichajes").select("usuario_id,odoo_estado,odoo_error").in("usuario_id", ids.length ? ids : [NADIE])
      .in("odoo_estado", ["error", "sin_empleado"]).order("momento", { ascending: false }),
  ]);
  const problemaOdoo = new Map<string, { odoo_estado: string; odoo_error: string | null }>();
  for (const x of (sinEnviar ?? []) as { usuario_id: string; odoo_estado: string; odoo_error: string | null }[]) {
    if (!problemaOdoo.has(x.usuario_id)) problemaOdoo.set(x.usuario_id, x);
  }
  const pendientes = (porResolver ?? []) as Ausencia[];
  const idsPendientes = [...new Set(pendientes.map((a) => a.usuario_id))];
  const [{ data: quienes }, { data: susCentros }] = idsPendientes.length ? await Promise.all([
    supabase.from("usuarios").select("id,nombre,codigo").in("id", idsPendientes),
    supabase.from("usuario_perfil").select("usuario_id,centros(nombre)").in("usuario_id", idsPendientes),
  ]) : [{ data: [] }, { data: [] }];
  const nombrePendiente = new Map(((quienes ?? []) as { id: string; nombre: string; codigo: string | null }[])
    .map((p) => [p.id, p.nombre || p.codigo || "—"]));
  const centroDe = new Map<string, string>();
  for (const x of (susCentros ?? []) as unknown as { usuario_id: string; centros: { nombre: string } | null }[]) {
    centroDe.set(x.usuario_id, [centroDe.get(x.usuario_id), x.centros?.nombre ?? "Sin centro"].filter(Boolean).join(" · "));
  }
  const fichajes = (f ?? []) as Fichaje[];
  const ausencias = (aus ?? []) as Ausencia[];
  const camiones = new Map(((asig ?? []) as unknown as { usuario_id: string; inicio: string; vehiculos: { matricula: string } }[])
    .map((a) => [a.usuario_id, a]));
  const nombre = new Map(miembros.map((x) => [x.usuario_id, x.usuarios.nombre || x.usuarios.codigo || "—"]));
  const desdeHoy = inicioDia().getTime();

  const filas = miembros.map((x) => {
    const suyos = fichajes.filter((y) => y.usuario_id === x.usuario_id);
    const hoyF = suyos.filter((y) => new Date(y.momento).getTime() >= desdeHoy);
    const ausenteHoy = ausencias.find((a) => a.usuario_id === x.usuario_id && a.estado === "aprobada" && a.desde <= hoy && a.hasta >= hoy);
    const estado = estadoDe(suyos);
    const jornada = estado === "fuera" ? hoyF : jornadaEnCurso(suyos);
    return { x, estado, entrada: jornada.find((y) => y.tipo === "entrada"), min: minutosTrabajados(jornada),
      odoo: problemaOdoo.get(x.usuario_id), ausenteHoy, camion: camiones.get(x.usuario_id) };
  });
  const cuenta = { trabajando: 0, pausa: 0, fuera: 0, ausente: 0 };
  for (const r of filas) r.ausenteHoy ? cuenta.ausente++ : cuenta[r.estado]++;

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.email || ""} admin={veArea("admin")} />
      <main className="contenido">
        <div className="admin-cabecera"><h1>Mi equipo</h1>
          {puede("zonas.gestionar") && <Link className="btn pequeno" href="/equipo/zonas">Chóferes por cliente o ruta</Link>}</div>
        {centros.length > 1 && (
          <nav className="chips" style={{ margin: "8px 0 16px" }} aria-label="Centro">
            {centros.map((c) => (
              <Link key={c.id} href={`/equipo?centro=${c.id}`} className={`etiqueta ${c.id === elegido.id ? "ok" : ""}`}>{c.nombre}</Link>
            ))}
          </nav>
        )}
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        {aprobar && <section className="panel">
          <h2>Vacaciones y ausencias por aprobar ({pendientes.length})</h2>
          <p className="hint">De todas las personas que tienes a tu cargo, de cualquier centro.</p>
          {pendientes.length === 0 ? <p className="hint">No hay solicitudes pendientes.</p> : pendientes.map((a) => (
            <form key={a.id} action={resolverAusencia} className="solicitud">
              <SinEnvioConIntro />
              <input type="hidden" name="id" value={a.id} />
              <p><b>{nombrePendiente.get(a.usuario_id) ?? "—"}</b> <span className="hint">({centroDe.get(a.usuario_id) ?? "Sin centro"})</span>
                {" "}· {NOMBRE_AUSENCIA[a.tipo]} · {fecha(a.desde + "T12:00:00Z")}
                {a.hasta !== a.desde && <> – {fecha(a.hasta + "T12:00:00Z")}</>}
                {a.motivo && <span className="hint"> · «{a.motivo}»</span>}</p>
              <input name="comentario" placeholder="Comentario (opcional)" maxLength={300} aria-label="Comentario" />
              <div className="chips" style={{ marginTop: 8 }}>
                <button name="decision" value="aprobar" className="btn primario">Aprobar</button>
                <button name="decision" value="rechazar" className="btn">Rechazar</button>
              </div>
            </form>
          ))}
          {ausencias.filter((a) => a.estado === "aprobada").length > 0 && (
            <>
              <h3 style={{ marginTop: 20 }}>Próximas ausencias aprobadas · {elegido.nombre}</h3>
              <ul className="lista-fichajes">
                {ausencias.filter((a) => a.estado === "aprobada").map((a) => (
                  <li key={a.id}>{nombre.get(a.usuario_id)} · {NOMBRE_AUSENCIA[a.tipo]} · {fecha(a.desde + "T12:00:00Z")}
                    {a.hasta !== a.desde && <> – {fecha(a.hasta + "T12:00:00Z")}</>} <EstadoOdoo estado={a.odoo_estado} error={a.odoo_error} /></li>
                ))}
              </ul>
            </>
          )}
        </section>}

        {verEquipo && <>
        <div className="cifras">
          <div className="panel"><b>{cuenta.trabajando}</b><span>Trabajando</span></div>
          <div className="panel"><b>{cuenta.pausa}</b><span>En pausa</span></div>
          <div className="panel"><b>{cuenta.fuera}</b><span>Sin fichar o han salido</span></div>
          <div className="panel"><b>{cuenta.ausente}</b><span>De vacaciones o ausentes</span></div>
        </div>

        <section className="panel">
          <h2>Hoy · {elegido.nombre}</h2>
          {filas.length === 0 ? <p className="hint">No hay nadie en este centro. Asigna personas desde Administración.</p> : (
            <table>
              <thead><tr><th>Persona</th><th>Estado</th><th>Entrada</th><th>Horas hoy</th><th>Camión</th></tr></thead>
              <tbody>
                {filas.map(({ x, estado, entrada, min, odoo, ausenteHoy, camion }) => (
                  <tr key={x.usuario_id}>
                    <td><b>{nombre.get(x.usuario_id)}</b><br /><span className="hint">{x.perfiles.join(" · ")}</span></td>
                    <td>
                      <span className={`etiqueta ${estado === "trabajando" ? "ok" : ""}`}>
                        {ausenteHoy ? NOMBRE_AUSENCIA[ausenteHoy.tipo] : NOMBRE_ESTADO[estado]}
                      </span>
                      {odoo && <div style={{ marginTop: 6 }}>
                        <EstadoOdoo estado={odoo.odoo_estado} error={odoo.odoo_estado === "sin_empleado"
                          ? `${odoo.odoo_error ?? "Falta su ficha de empleado en Odoo"}. Lo arregla la administración.` : odoo.odoo_error} detalle />
                        {odoo.odoo_estado === "error" && corregir && <form action={reintentarOdoo}>
                          <input type="hidden" name="usuario_id" value={x.usuario_id} />
                          <button className="btn pequeno">Reintentar</button>
                        </form>}
                      </div>}
                    </td>
                    <td>{entrada ? hora(entrada.momento) : "—"}</td>
                    <td>{min ? duracion(min) : "—"}</td>
                    <td>{camion ? <>{camion.vehiculos.matricula}<br /><span className="hint">desde {hora(camion.inicio)}</span></> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        </>}

        {corregir && <section className="panel">
          <h2>Corregir un fichaje</h2>
          <p className="hint">Si alguien se olvidó de fichar o se equivocó. No se borra nada: se añade la corrección con su motivo.</p>
          <form action={corregirFichaje}>
            <div className="fila-form">
              <div><label htmlFor="usuario_id">Persona</label>
                <select id="usuario_id" name="usuario_id" required defaultValue="">
                  <option value="" disabled>—</option>
                  {miembros.filter((x) => x.usuario_id !== uid).map((x) => <option key={x.usuario_id} value={x.usuario_id}>{nombre.get(x.usuario_id)}</option>)}
                </select></div>
              <div><label htmlFor="tipo">Fichaje</label>
                <select id="tipo" name="tipo" required defaultValue="entrada">
                  {Object.entries(NOMBRE_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div><label htmlFor="momento">Fecha y hora</label><input id="momento" name="momento" type="datetime-local" required /></div>
            </div>
            <label htmlFor="nota">Motivo</label>
            <input id="nota" name="nota" required maxLength={300} placeholder="Ej.: se olvidó de fichar la salida" />
            <button className="btn primario" style={{ marginTop: 14 }}>Guardar corrección</button>
          </form>
        </section>}
      </main>
    </>
  );
}
