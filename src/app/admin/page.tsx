import Cabecera from "../Cabecera";
import { AREAS } from "@/lib/permisos";
import { DOCUMENTOS_PERSONA } from "@/lib/seguridad";
import { conPermiso } from "@/lib/usuario";
import {
  asignarPerfil, borrarPerfil, cambiarPin, cambiarVehiculo, configurarUsuario, crearCentro, crearPerfil, crearUsuarioPin, crearVehiculo,
  guardarPerfil, guardarUsuario, quitarPerfil,
} from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administración · Grupo Trimodos" };

type Centro = { id: number; nombre: string };
type PerfilRol = { id: number; nombre: string; descripcion: string | null; permisos: string[]; todos_los_centros: boolean; documentos: string[] };
type Fila = {
  id: string; nombre: string; email: string | null; codigo: string | null; activo: boolean; es_admin: boolean;
  odoo_employee_id: number | null;
  usuario_perfil: { id: number; perfil_id: number; centro_id: number | null }[];
};

/** Perfil y centro. Al dar de alta, los dos son obligatorios: sin centro, ningún responsable recibe sus solicitudes. */
function ElegirPerfilCentro({ perfiles, centros, obligatorio = false }: { perfiles: PerfilRol[]; centros: Centro[]; obligatorio?: boolean }) {
  return (
    <>
      <div>
        <label>Perfil</label>
        <select name="perfil" defaultValue="" required={obligatorio}>
          <option value="" disabled={obligatorio}>{obligatorio ? "Elige…" : "—"}</option>
          {perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      <div>
        <label>Centro</label>
        <select name="centro" defaultValue="" required={obligatorio}>
          <option value="" disabled={obligatorio}>{obligatorio ? "Elige…" : "Sin centro (solo lo gestiona la administración)"}</option>
          {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>
    </>
  );
}

/** Casillas de permisos agrupadas por área, sacadas del catálogo: una función nueva aparece aquí sola. */
function ElegirPermisos({ marcados = [] }: { marcados?: string[] }) {
  return (
    <div className="areas-permisos">
      {AREAS.map((a) => (
        <fieldset key={a.id}>
          <legend>{a.nombre}</legend>
          {a.permisos.map((p) => (
            <label key={p.id}>
              <input type="checkbox" name="permisos" value={p.id} defaultChecked={marcados.includes(p.id)} /> {p.nombre}
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function CamposPerfil({ p }: { p?: PerfilRol }) {
  return (
    <>
      <div className="fila-form">
        <div><label>Nombre</label><input name="nombre" required defaultValue={p?.nombre} placeholder="Ej.: Jefe de tráfico" /></div>
        <div><label>Descripción</label><input name="descripcion" defaultValue={p?.descripcion ?? ""} /></div>
      </div>
      <label style={{ marginTop: 12 }}>Qué puede ver y hacer</label>
      <ElegirPermisos marcados={p?.permisos} />
      <div className="areas-permisos" style={{ marginTop: 12 }}><fieldset>
        <legend>Documentación que pide este puesto</legend>
        {Object.entries(DOCUMENTOS_PERSONA).map(([id, nombre]) => (
          <label key={id}><input type="checkbox" name="documentos" value={id} defaultChecked={p?.documentos.includes(id)} /> {nombre}</label>
        ))}
        <span className="hint">A quien tenga este perfil se le pedirá en «Mi documentación» y se le avisará en su inicio.</span>
      </fieldset></div>
      <label className="chips" style={{ marginTop: 12 }}>
        <span><input type="checkbox" name="todos_los_centros" defaultChecked={p?.todos_los_centros} /> Sus permisos sobre otras
          personas (ver equipo, aprobar, corregir) valen en <b>todos los centros</b>, no solo en el suyo</span>
      </label>
    </>
  );
}

export default async function Admin({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, perfil, puede } = await conPermiso("admin.usuarios", "vehiculos.gestionar", "admin.sincronizacion");
  const { ok, error } = await searchParams;
  const gestionaUsuarios = puede("admin.usuarios");

  const [{ data: usuarios }, { data: centros }, { data: perfiles }, { data: vehiculos }] = await Promise.all([
    gestionaUsuarios
      ? supabase.from("usuarios").select("id,nombre,email,codigo,activo,es_admin,odoo_employee_id,usuario_perfil(id,perfil_id,centro_id)")
        .order("nombre").returns<Fila[]>()
      : Promise.resolve({ data: [] as Fila[] }),
    supabase.from("centros").select("id,nombre").order("nombre").returns<Centro[]>(),
    supabase.from("perfiles").select("id,nombre,descripcion,permisos,todos_los_centros,documentos").order("nombre").returns<PerfilRol[]>(),
    supabase.from("vehiculos").select("id,matricula,modelo,centro_id,activo").order("matricula")
      .returns<{ id: number; matricula: string; modelo: string | null; centro_id: number | null; activo: boolean }[]>(),
  ]);
  const listaCentros = centros ?? [];
  const listaPerfiles = perfiles ?? [];
  const nombreCentro = new Map(listaCentros.map((c) => [c.id, c.nombre]));
  const nombrePerfil = new Map(listaPerfiles.map((p) => [p.id, p.nombre]));
  // Sin ningún perfil no ven nada y nadie recibe lo que piden: van arriba, con un solo paso para dejarlos listos.
  const porConfigurar = (usuarios ?? []).filter((u) => !u.es_admin && u.usuario_perfil.length === 0);
  const usos = new Map<number, number>();
  for (const u of usuarios ?? []) for (const a of u.usuario_perfil) usos.set(a.perfil_id, (usos.get(a.perfil_id) ?? 0) + 1);

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.email || ""} admin />
      <main className="contenido">
        <h1>Administración</h1>
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        {puede("admin.sincronizacion") && (
          <a className="modulo" href="/admin/sincronizacion" style={{ marginBottom: 16 }}>
            <h2>Sincronización con Odoo</h2>
            <p>Qué va a dónde, qué falta por enviar y qué hay que arreglar.</p>
          </a>
        )}

        {gestionaUsuarios && <>
        {porConfigurar.length > 0 && <section className="panel por-configurar" id="por-configurar">
          <h2>Personas por configurar ({porConfigurar.length})</h2>
          <p className="hint">No tienen perfil: no ven nada y lo que pidan no le llega a nadie. Elige su puesto y su centro y quedan activas.</p>
          {porConfigurar.map((u) => <form key={u.id} action={configurarUsuario} className="fila-form configurar">
            <input type="hidden" name="id" value={u.id} />
            <div><b>{u.nombre || "(sin nombre)"}</b><div className="hint">{u.codigo ? `Código ${u.codigo} + PIN` : `Microsoft · ${u.email ?? ""}`}
              {!u.activo && " · inactivo"}</div></div>
            <ElegirPerfilCentro perfiles={listaPerfiles} centros={listaCentros} obligatorio />
            <button className="btn primario">Activar con este perfil</button>
          </form>)}
        </section>}

        <section className="panel">
          <h2>Usuarios ({usuarios?.length ?? 0})</h2>
          <p className="hint">El personal de oficina aparece aquí al entrar por primera vez con Microsoft: actívalo y asígnale uno o
            varios perfiles. Lo que ve y puede hacer cada persona es la suma de sus perfiles.</p>
          <table>
            <thead><tr><th>Usuario</th><th>Acceso</th><th>Perfiles</th><th>Editar</th></tr></thead>
            <tbody>
              {(usuarios ?? []).map((u) => (
                <tr key={u.id}>
                  <td>
                    <b>{u.nombre || "(sin nombre)"}</b><br />
                    <span className={`etiqueta ${u.activo ? "ok" : ""}`}>{u.activo ? "Activo" : "Inactivo"}</span>{" "}
                    {u.es_admin && <span className="etiqueta">Superadministrador</span>}
                  </td>
                  <td>{u.codigo ? <>Código <b>{u.codigo}</b> + PIN</> : <>Microsoft<br /><span className="hint">{u.email}</span></>}</td>
                  <td>
                    {u.usuario_perfil.length === 0 && <span className="hint">{u.es_admin ? "Todo" : "Ninguno"}</span>}
                    {u.usuario_perfil.map((a) => (
                      <form key={a.id} action={quitarPerfil} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="hidden" name="asignacion" value={a.id} />
                        <span>{nombrePerfil.get(a.perfil_id)} · {a.centro_id ? nombreCentro.get(a.centro_id) : "sin centro"}</span>
                        <button className="btn pequeno" aria-label="Quitar perfil" title="Quitar">×</button>
                      </form>
                    ))}
                  </td>
                  <td>
                    <details>
                      <summary>Editar</summary>
                      <form action={asignarPerfil} className="fila-form">
                        <input type="hidden" name="id" value={u.id} />
                        <ElegirPerfilCentro perfiles={listaPerfiles} centros={listaCentros} />
                        <button className="btn">Añadir perfil</button>
                      </form>
                      <form action={guardarUsuario} style={{ marginTop: 14 }}>
                        <input type="hidden" name="id" value={u.id} />
                        <div className="fila-form">
                          <div><label>Nombre</label><input name="nombre" defaultValue={u.nombre} /></div>
                          <div>
                            <label>Id de empleado en Odoo</label>
                            <input name="odoo_employee_id" inputMode="numeric" defaultValue={u.odoo_employee_id ?? ""}
                              placeholder="Se rellena solo al sincronizar" />
                          </div>
                        </div>
                        <div className="chips" style={{ marginTop: 12 }}>
                          <label><input type="checkbox" name="activo" defaultChecked={u.activo} /> Activo</label>
                          {perfil.es_admin && (
                            <label><input type="checkbox" name="es_admin" defaultChecked={u.es_admin} /> Superadministrador (todo)</label>
                          )}
                        </div>
                        <button className="btn primario" style={{ marginTop: 14 }}>Guardar</button>
                      </form>
                      {u.codigo && (
                        <form action={cambiarPin} className="fila-form" style={{ marginTop: 14 }}>
                          <input type="hidden" name="id" value={u.id} />
                          <div>
                            <label>Nuevo PIN</label>
                            <input name="pin" type="password" inputMode="numeric" autoComplete="new-password" />
                          </div>
                          <button className="btn">Cambiar PIN</button>
                        </form>
                      )}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Nuevo conductor u operario (código + PIN)</h2>
          <form action={crearUsuarioPin}>
            <div className="fila-form">
              <div><label>Nombre</label><input name="nombre" required /></div>
              <div><label>Código</label><input name="codigo" required autoCapitalize="characters" /></div>
              <div><label>PIN (6 a 12 cifras)</label><input name="pin" type="password" inputMode="numeric" autoComplete="new-password" required /></div>
              <ElegirPerfilCentro perfiles={listaPerfiles} centros={listaCentros} obligatorio />
            </div>
            <button className="btn primario" style={{ marginTop: 14 }}>Crear usuario</button>
          </form>
        </section>

        <section className="panel">
          <h2>Perfiles ({listaPerfiles.length})</h2>
          <div className="normas">
            <b>Normas</b>
            <ul>
              <li>Cada persona tiene <b>un puesto</b> (Oficina, Chófer u Operario) <b>en su centro</b>.</li>
              <li><b>Responsable</b> se añade encima del puesto: aprueba las vacaciones y la ropa y corrige los fichajes de las
                personas de <b>su centro</b>. Sin responsable en un centro, lo resuelve la administración.</li>
              <li><b>Seguridad</b> vale en todos los centros: caducidades, carretillas, inspecciones e incidencias.</li>
              <li>Nadie aprueba lo suyo. Cada persona ve en su pantalla quién le aprueba, y a cada uno le llega lo suyo en la
                campana de arriba («Pendientes»).</li>
            </ul>
          </div>
          <p className="hint">Un perfil es un puesto (Chófer, Operario de almacén, Jefe de tráfico, RR. HH.…) con lo que puede ver y
            hacer. Al cambiar un perfil, cambia para todas las personas que lo tienen.</p>
          {listaPerfiles.map((p) => (
            <details key={p.id} className="perfil">
              <summary><b>{p.nombre}</b> <span className="hint">· {usos.get(p.id) ?? 0} personas · {p.permisos.length} permisos
                {p.todos_los_centros && " · todos los centros"}</span></summary>
              <form action={guardarPerfil}>
                <input type="hidden" name="id" value={p.id} />
                <CamposPerfil p={p} />
                <button className="btn primario" style={{ marginTop: 14 }}>Guardar perfil</button>
              </form>
              <form action={borrarPerfil} className="chips" style={{ marginTop: 14, alignItems: "center" }}>
                <input type="hidden" name="id" value={p.id} />
                <label><input type="checkbox" name="confirmar" /> Sí, quiero borrarlo ({usos.get(p.id) ?? 0} personas lo perderán)</label>
                <button className="btn pequeno">Borrar perfil</button>
              </form>
            </details>
          ))}
          <details className="perfil">
            <summary><b>+ Nuevo perfil</b></summary>
            <form action={crearPerfil}>
              <CamposPerfil />
              <button className="btn primario" style={{ marginTop: 14 }}>Crear perfil</button>
            </form>
          </details>
        </section>

        <section className="panel">
          <h2>Centros de trabajo</h2>
          <p>{listaCentros.map((c) => c.nombre).join(" · ") || <span className="hint">Todavía no hay centros.</span>}</p>
          <form action={crearCentro} className="fila-form">
            <div><label>Nuevo centro</label><input name="nombre" /></div>
            <button className="btn">Añadir centro</button>
          </form>
        </section>
        </>}

        {puede("vehiculos.gestionar") && (
        <section className="panel">
          <h2>Camiones (cabezas tractoras)</h2>
          <p className="hint">Los conductores eligen o confirman su camión de esta lista. El centro de flota consulta directamente los vehículos disponibles en Movildata.
            La ITV, el seguro y la revisión del tacógrafo de cada camión se apuntan en <a href="/seguridad?ver=vehiculos">Seguridad → Vehículos</a>.</p>
          {(vehiculos ?? []).length > 0 && (
            <table>
              <thead><tr><th>Matrícula</th><th>Modelo</th><th>Centro</th><th>Activo</th></tr></thead>
              <tbody>
                {(vehiculos ?? []).map((v) => (
                  <tr key={v.id}>
                    <td><b>{v.matricula}</b></td><td>{v.modelo ?? "—"}</td><td>{v.centro_id ? nombreCentro.get(v.centro_id) : "—"}</td>
                    <td>
                      <form action={cambiarVehiculo} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="hidden" name="id" value={v.id} />
                        <input type="checkbox" name="activo" defaultChecked={v.activo} aria-label="Activo" />
                        <button className="btn pequeno">Guardar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form action={crearVehiculo} className="fila-form" style={{ marginTop: 12 }}>
            <div><label>Matrícula</label><input name="matricula" required autoCapitalize="characters" /></div>
            <div><label>Modelo</label><input name="modelo" /></div>
            <div>
              <label>Centro</label>
              <select name="centro" defaultValue="">
                <option value="">—</option>
                {listaCentros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <button className="btn">Añadir camión</button>
          </form>
        </section>
        )}
      </main>
    </>
  );
}
