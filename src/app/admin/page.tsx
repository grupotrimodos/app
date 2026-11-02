import { redirect } from "next/navigation";
import Cabecera from "../Cabecera";
import { MODULOS, NOMBRE_ROL, ROLES, type Rol } from "@/lib/modulos";
import { usuarioActual } from "@/lib/usuario";
import { cambiarPin, cambiarVehiculo, crearCentro, crearUsuarioPin, crearVehiculo, guardarUsuario, quitarCentro } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administración · Grupo Trimodos" };

type Fila = {
  id: string; nombre: string; email: string | null; codigo: string | null; activo: boolean; es_admin: boolean;
  modulos: string[]; odoo_employee_id: number | null;
  usuario_centro_rol: { centro_id: number; rol: Rol }[];
};

function ElegirCentroRol({ centros }: { centros: { id: number; nombre: string }[] }) {
  return (
    <>
      <div>
        <label>Centro</label>
        <select name="centro" defaultValue="">
          <option value="">—</option>
          {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>
      <div>
        <label>Rol en ese centro</label>
        <select name="rol" defaultValue="">
          <option value="">—</option>
          {ROLES.map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}
        </select>
      </div>
    </>
  );
}

function ElegirModulos({ marcados = [] }: { marcados?: string[] }) {
  return (
    <div className="chips">
      {MODULOS.map((m) => (
        <label key={m.id}>
          <input type="checkbox" name="modulos" value={m.id} defaultChecked={marcados.includes(m.id)} /> {m.nombre}
        </label>
      ))}
    </div>
  );
}

export default async function Admin({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, perfil } = await usuarioActual();
  if (!perfil?.es_admin || !perfil.activo) redirect("/");
  const { ok, error } = await searchParams;

  const [{ data: usuarios }, { data: centros }, { data: vehiculos }] = await Promise.all([
    supabase.from("usuarios")
      .select("id,nombre,email,codigo,activo,es_admin,modulos,odoo_employee_id,usuario_centro_rol(centro_id,rol)")
      .order("nombre").returns<Fila[]>(),
    supabase.from("centros").select("id,nombre").order("nombre").returns<{ id: number; nombre: string }[]>(),
    supabase.from("vehiculos").select("id,matricula,modelo,centro_id,activo").order("matricula")
      .returns<{ id: number; matricula: string; modelo: string | null; centro_id: number | null; activo: boolean }[]>(),
  ]);
  const nombreCentro = new Map((centros ?? []).map((c) => [c.id, c.nombre]));

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.email || ""} admin />
      <main className="contenido">
        <h1>Administración</h1>
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <section className="panel">
          <h2>Usuarios ({usuarios?.length ?? 0})</h2>
          <p className="hint">El personal de oficina aparece aquí al entrar por primera vez con Microsoft; actívale sus módulos.</p>
          <table>
            <thead><tr><th>Usuario</th><th>Acceso</th><th>Centros</th><th>Editar</th></tr></thead>
            <tbody>
              {(usuarios ?? []).map((u) => (
                <tr key={u.id}>
                  <td>
                    <b>{u.nombre || "(sin nombre)"}</b><br />
                    <span className={`etiqueta ${u.activo ? "ok" : ""}`}>{u.activo ? "Activo" : "Inactivo"}</span>{" "}
                    {u.es_admin && <span className="etiqueta">Admin</span>}
                  </td>
                  <td>{u.codigo ? <>Código <b>{u.codigo}</b> + PIN</> : <>Microsoft<br /><span className="hint">{u.email}</span></>}</td>
                  <td>
                    {u.usuario_centro_rol.length === 0 && <span className="hint">—</span>}
                    {u.usuario_centro_rol.map((r) => (
                      <form key={r.centro_id} action={quitarCentro} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="centro" value={r.centro_id} />
                        <span>{nombreCentro.get(r.centro_id)} · {NOMBRE_ROL[r.rol]}</span>
                        <button className="btn pequeno" aria-label="Quitar centro" title="Quitar">×</button>
                      </form>
                    ))}
                  </td>
                  <td>
                    <details>
                      <summary>Editar</summary>
                      <form action={guardarUsuario}>
                        <input type="hidden" name="id" value={u.id} />
                        <label>Nombre</label>
                        <input name="nombre" defaultValue={u.nombre} />
                        <label>Módulos</label>
                        <ElegirModulos marcados={u.modulos} />
                        <div className="chips" style={{ marginTop: 12 }}>
                          <label><input type="checkbox" name="activo" defaultChecked={u.activo} /> Activo</label>
                          <label><input type="checkbox" name="es_admin" defaultChecked={u.es_admin} /> Administrador</label>
                        </div>
                        <div className="fila-form">
                          <ElegirCentroRol centros={centros ?? []} />
                          <div>
                            <label>Id de empleado en Odoo</label>
                            <input name="odoo_employee_id" inputMode="numeric" defaultValue={u.odoo_employee_id ?? ""} />
                          </div>
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
              <ElegirCentroRol centros={centros ?? []} />
            </div>
            <label>Módulos</label>
            <ElegirModulos marcados={["fichaje"]} />
            <button className="btn primario" style={{ marginTop: 14 }}>Crear usuario</button>
          </form>
        </section>

        <section className="panel">
          <h2>Centros de trabajo</h2>
          <p>{(centros ?? []).map((c) => c.nombre).join(" · ") || <span className="hint">Todavía no hay centros.</span>}</p>
          <form action={crearCentro} className="fila-form">
            <div><label>Nuevo centro</label><input name="nombre" /></div>
            <button className="btn">Añadir centro</button>
          </form>
        </section>
        <section className="panel">
          <h2>Camiones (cabezas tractoras)</h2>
          <p className="hint">Los chóferes eligen o confirman su camión de esta lista. El «id de Movildata» se rellenará al conectar su API.</p>
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
                {(centros ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <button className="btn">Añadir camión</button>
          </form>
        </section>
      </main>
    </>
  );
}
