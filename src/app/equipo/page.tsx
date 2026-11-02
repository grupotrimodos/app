import Link from "next/link";
import { redirect } from "next/navigation";
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
type Fila = { usuario_id: string; perfiles: { nombre: string }; usuarios: { nombre: string; codigo: string | null; activo: boolean } };
type Miembro = { usuario_id: string; perfiles: string[]; usuarios: Fila["usuarios"] };
type Ausencia = { id: number; usuario_id: string; tipo: string; desde: string; hasta: string; motivo: string | null; estado: string;
  odoo_estado: string; odoo_error: string | null };

export default async function PaginaEquipo({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; centro?: string }> }) {
  const { supabase, uid, perfil, puede, veArea } = await conPermiso(...permisosDe("equipo"));
  const centros = await centrosConPermiso(supabase, uid, perfil.es_admin, permisosDe("equipo"));
  if (centros.length === 0) redirect("/");
  const verEquipo = puede("equipo.ver"), aprobar = puede("ausencias.aprobar"), corregir = puede("fichaje.corregir");
  const { ok, error, centro } = await searchParams;
  const elegido = centros.find((c) => String(c.id) === centro) ?? centros[0];

  // Personas con algún perfil en este centro (una persona puede tener varios perfiles).
  const { data: m } = await supabase.from("usuario_perfil").select("usuario_id,perfiles(nombre),usuarios(nombre,codigo,activo)")
    .eq("centro_id", elegido.id);
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

  const [{ data: f }, { data: aus }, { data: asig }] = await Promise.all([
    supabase.from("fichajes").select("id,usuario_id,tipo,momento,origen,nota,odoo_estado,odoo_error")
      .in("usuario_id", ids.length ? ids : [NADIE]).gte("momento", inicioDia(1).toISOString()).order("momento"),
    supabase.from("ausencias").select("id,usuario_id,tipo,desde,hasta,motivo,estado,odoo_estado,odoo_error")
      .in("usuario_id", ids.length ? ids : [NADIE]).or(`estado.eq.pendiente,and(estado.eq.aprobada,hasta.gte.${hoy})`).order("desde"),
    supabase.from("asignaciones").select("usuario_id,inicio,vehiculos(matricula)")
      .in("usuario_id", ids.length ? ids : [NADIE]).is("fin", null),
  ]);
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
      errores: suyos.some((y) => y.odoo_estado === "error"), ausenteHoy, camion: camiones.get(x.usuario_id) };
  });
  const cuenta = { trabajando: 0, pausa: 0, fuera: 0, ausente: 0 };
  for (const r of filas) r.ausenteHoy ? cuenta.ausente++ : cuenta[r.estado]++;
  const pendientes = ausencias.filter((a) => a.estado === "pendiente" && a.usuario_id !== uid);

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.email || ""} admin={veArea("admin")} />
      <main className="contenido">
        <h1>Mi equipo · {elegido.nombre}</h1>
        {centros.length > 1 && (
          <nav className="chips" style={{ marginBottom: 16 }}>
            {centros.map((c) => (
              <Link key={c.id} href={`/equipo?centro=${c.id}`} className={`etiqueta ${c.id === elegido.id ? "ok" : ""}`}>{c.nombre}</Link>
            ))}
          </nav>
        )}
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        {verEquipo && <>
        <div className="cifras">
          <div className="panel"><b>{cuenta.trabajando}</b><span>Trabajando</span></div>
          <div className="panel"><b>{cuenta.pausa}</b><span>En pausa</span></div>
          <div className="panel"><b>{cuenta.fuera}</b><span>Sin fichar o han salido</span></div>
          <div className="panel"><b>{cuenta.ausente}</b><span>De vacaciones o ausentes</span></div>
        </div>

        <section className="panel">
          <h2>Hoy</h2>
          {filas.length === 0 ? <p className="hint">No hay nadie en este centro. Asigna personas desde Administración.</p> : (
            <table>
              <thead><tr><th>Persona</th><th>Estado</th><th>Entrada</th><th>Horas hoy</th><th>Camión</th></tr></thead>
              <tbody>
                {filas.map(({ x, estado, entrada, min, errores, ausenteHoy, camion }) => (
                  <tr key={x.usuario_id}>
                    <td><b>{nombre.get(x.usuario_id)}</b><br /><span className="hint">{x.perfiles.join(" · ")}</span></td>
                    <td>
                      <span className={`etiqueta ${estado === "trabajando" ? "ok" : ""}`}>
                        {ausenteHoy ? NOMBRE_AUSENCIA[ausenteHoy.tipo] : NOMBRE_ESTADO[estado]}
                      </span>
                      {errores && corregir && (
                        <form action={reintentarOdoo} style={{ marginTop: 6 }}>
                          <input type="hidden" name="usuario_id" value={x.usuario_id} />
                          <span className="etiqueta mal">Error con Odoo</span> <button className="btn pequeno">Reintentar</button>
                        </form>
                      )}
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

        {aprobar && <section className="panel">
          <h2>Solicitudes de ausencia ({pendientes.length})</h2>
          {pendientes.length === 0 ? <p className="hint">No hay solicitudes pendientes.</p> : pendientes.map((a) => (
            <form key={a.id} action={resolverAusencia} className="solicitud">
              <input type="hidden" name="id" value={a.id} />
              <p><b>{nombre.get(a.usuario_id)}</b> · {NOMBRE_AUSENCIA[a.tipo]} · {fecha(a.desde + "T12:00:00Z")}
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
              <h3 style={{ marginTop: 20 }}>Próximas ausencias aprobadas</h3>
              <ul className="lista-fichajes">
                {ausencias.filter((a) => a.estado === "aprobada").map((a) => (
                  <li key={a.id}>{nombre.get(a.usuario_id)} · {NOMBRE_AUSENCIA[a.tipo]} · {fecha(a.desde + "T12:00:00Z")}
                    {a.hasta !== a.desde && <> – {fecha(a.hasta + "T12:00:00Z")}</>} <EstadoOdoo estado={a.odoo_estado} error={a.odoo_error} /></li>
                ))}
              </ul>
            </>
          )}
        </section>}

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
