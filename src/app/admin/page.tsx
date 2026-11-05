import Link from "next/link";
import { Suspense } from "react";
import Cabecera from "../Cabecera";
import { AREAS, NOMBRE_PANTALLA, type Pantalla } from "@/lib/permisos";
import { llamarPythonDetalle } from "@/lib/python";
import { DOCUMENTOS_PERSONA } from "@/lib/seguridad";
import { conPermiso } from "@/lib/usuario";
import {
  asignarAnalitica, asignarPerfil, borrarPerfil, cambiarPin, cambiarPuesto, cambiarVehiculo, configurarVarios, crearCentro, crearPerfil,
  crearUsuarioPin, crearVehiculo, guardarPerfil, guardarUsuario, quitarAnalitica, quitarPerfil,
} from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administración · Grupo Trimodos" };

type Centro = { id: number; nombre: string };
type PerfilRol = { id: number; nombre: string; descripcion: string | null; permisos: string[]; todos_los_centros: boolean; documentos: string[];
  pantalla: Pantalla | null; base: boolean };
type Fila = {
  id: string; nombre: string; email: string | null; codigo: string | null; activo: boolean; es_admin: boolean; creado: string;
  odoo_employee_id: number | null;
  usuario_perfil: { id: number; perfil_id: number; centro_id: number | null }[];
};
type Busqueda = { ok?: string; error?: string; ver?: string; q?: string; centro?: string; perfil?: string; estado?: string; pag?: string };
const POR_PAGINA = 50;

/** Con qué cuenta entra: la de la empresa es de Microsoft; cualquier otro correo, de Google. */
const entraCon = (email: string | null) => (email?.toLowerCase().endsWith("@grupotrimodos.com") ? "Microsoft" : "Google");
const acceso = (u: Fila) => (u.codigo ? `Código ${u.codigo} + PIN` : `${entraCon(u.email)} · ${u.email ?? ""}`);

/** Puesto y centro. Al dar de alta, los dos son obligatorios: sin centro, ningún responsable recibe sus solicitudes. */
function ElegirPerfilCentro({ perfiles, centros, obligatorio = false, etiqueta = "Perfil", id }: {
  perfiles: PerfilRol[]; centros: Centro[]; obligatorio?: boolean; etiqueta?: string; id: string;
}) {
  return <>
    <div>
      <label htmlFor={`${id}-perfil`}>{etiqueta}</label>
      <select id={`${id}-perfil`} name="perfil" defaultValue="" required={obligatorio}>
        <option value="" disabled={obligatorio}>{obligatorio ? "Elige…" : "—"}</option>
        {perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select>
    </div>
    <div>
      <label htmlFor={`${id}-centro`}>Centro</label>
      <select id={`${id}-centro`} name="centro" defaultValue="">
        <option value="">{obligatorio ? "Elige… (Administrador: ninguno)" : "Sin centro (todos los centros)"}</option>
        {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
    </div>
  </>;
}

/** Casillas de permisos agrupadas por área, sacadas del catálogo: una función nueva aparece aquí sola. */
function ElegirPermisos({ marcados = [] }: { marcados?: string[] }) {
  return <div className="areas-permisos">
    {AREAS.map((a) => <fieldset key={a.id}>
      <legend>{a.nombre}</legend>
      {a.permisos.map((p) => <label key={p.id}>
        <input type="checkbox" name="permisos" value={p.id} defaultChecked={marcados.includes(p.id)} /> {p.nombre}
      </label>)}
    </fieldset>)}
  </div>;
}

function CamposPerfil({ p }: { p?: PerfilRol }) {
  return <>
    <div className="fila-form">
      <div><label>Nombre</label><input name="nombre" required defaultValue={p?.nombre} readOnly={p?.base} placeholder="Ej.: Jefe de tráfico" /></div>
      <div><label>Descripción</label><input name="descripcion" defaultValue={p?.descripcion ?? ""} /></div>
      {p?.base ? <div><label>Pantalla</label><p className="hint">{p.pantalla ? NOMBRE_PANTALLA[p.pantalla] : "—"} (fija: es uno de los cuatro básicos)</p></div>
        : <div><label>Es un…</label><select name="pantalla" defaultValue={p?.pantalla ?? ""}>
          <option value="">Complemento (se suma a un puesto)</option>
          {(Object.keys(NOMBRE_PANTALLA) as Pantalla[]).map((k) => <option key={k} value={k}>Puesto · {NOMBRE_PANTALLA[k]}</option>)}
        </select></div>}
    </div>
    <label style={{ marginTop: 12 }}>Qué puede ver y hacer</label>
    <ElegirPermisos marcados={p?.permisos} />
    <div className="areas-permisos" style={{ marginTop: 12 }}><fieldset>
      <legend>Documentación que pide este puesto</legend>
      {Object.entries(DOCUMENTOS_PERSONA).map(([id, nombre]) => <label key={id}>
        <input type="checkbox" name="documentos" value={id} defaultChecked={p?.documentos.includes(id)} /> {nombre}</label>)}
      <span className="hint">A quien tenga este perfil se le pedirá en «Mi documentación» y se le avisará en su inicio.</span>
    </fieldset></div>
    <label className="chips" style={{ marginTop: 12 }}>
      <span><input type="checkbox" name="todos_los_centros" defaultChecked={p?.todos_los_centros} /> Sus permisos sobre otras
        personas (ver equipo, aprobar, corregir) valen en <b>todos los centros</b>, no solo en el suyo</span>
    </label>
  </>;
}

export default async function Admin({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const { supabase, perfil, puede } = await conPermiso("admin.usuarios", "vehiculos.gestionar", "admin.sincronizacion");
  const sp = await searchParams;
  const gestionaUsuarios = puede("admin.usuarios");
  const pestanas = ([["personas", "Personas", gestionaUsuarios], ["perfiles", "Perfiles", gestionaUsuarios], ["centros", "Centros", gestionaUsuarios],
    ["camiones", "Camiones", puede("vehiculos.gestionar")]] as const).filter(([, , si]) => si);
  const vista = pestanas.find(([id]) => id === sp.ver)?.[0] ?? pestanas[0]?.[0];
  const [{ data: centros }, { data: perfiles }] = await Promise.all([
    supabase.from("centros").select("id,nombre").order("nombre").returns<Centro[]>(),
    supabase.from("perfiles").select("id,nombre,descripcion,permisos,todos_los_centros,documentos,pantalla,base").order("nombre").returns<PerfilRol[]>(),
  ]);
  // Primero los cuatro básicos (en el orden de la empresa) y luego los complementos.
  const ORDEN: Record<string, number> = { direccion: 0, oficina: 1, campo: 2 };
  const listaPerfiles = (perfiles ?? []).sort((a, b) => Number(b.base) - Number(a.base)
    || (ORDEN[a.pantalla ?? ""] ?? 9) - (ORDEN[b.pantalla ?? ""] ?? 9) || a.nombre.localeCompare(b.nombre));

  return <>
    <Cabecera nombre={perfil.nombre || perfil.email || ""} />
    <main className="contenido">
      <div className="admin-cabecera">
        <h1>Administración</h1>
        {puede("admin.sincronizacion") && <Link className="btn pequeno" href="/admin/sincronizacion">Sincronización con Odoo</Link>}
      </div>
      {pestanas.length > 0 && <nav className="pestanas" aria-label="Secciones de administración">
        {pestanas.map(([id, nombre]) => <Link key={id} href={`/admin?ver=${id}`} className={vista === id ? "activa" : ""}
          aria-current={vista === id ? "page" : undefined}>{nombre}</Link>)}
      </nav>}
      {sp.ok && <p className="aviso" role="status">{sp.ok}</p>}
      {sp.error && <p className="error" role="alert">{sp.error}</p>}
      {vista === "personas" && <Personas sp={sp} perfiles={listaPerfiles} centros={centros ?? []} esAdmin={perfil.es_admin} />}
      {vista === "perfiles" && <Perfiles perfiles={listaPerfiles} />}
      {vista === "centros" && <Centros centros={centros ?? []} />}
      {vista === "camiones" && <Camiones centros={centros ?? []} />}
    </main>
  </>;
}

/* ---------------------------------------------------------------- personas */
async function Personas({ sp, perfiles, centros, esAdmin }: { sp: Busqueda; perfiles: PerfilRol[]; centros: Centro[]; esAdmin: boolean }) {
  const { supabase } = await conPermiso("admin.usuarios");
  const { data } = await supabase.from("usuarios")
    .select("id,nombre,email,codigo,activo,es_admin,creado,odoo_employee_id,usuario_perfil(id,perfil_id,centro_id)").order("nombre").returns<Fila[]>();
  const usuarios = data ?? [];
  const nombreCentro = new Map(centros.map((c) => [c.id, c.nombre]));
  const perfilDe = new Map(perfiles.map((p) => [p.id, p]));
  const puestos = perfiles.filter((p) => p.pantalla);
  const complementos = perfiles.filter((p) => !p.pantalla);
  const sinPerfil = (u: Fila) => !u.es_admin && u.usuario_perfil.length === 0;
  const sinCentro = (u: Fila) => u.usuario_perfil.some((a) => !a.centro_id && !perfilDe.get(a.perfil_id)?.todos_los_centros);
  const porConfigurar = usuarios.filter(sinPerfil);

  const q = (sp.q ?? "").trim().toLowerCase();
  const filtroCentro = Number(sp.centro) || null, filtroPerfil = Number(sp.perfil) || null;
  const filtradas = usuarios.filter((u) =>
    (!q || [u.nombre, u.email, u.codigo].some((x) => x?.toLowerCase().includes(q)))
    && (!filtroCentro || u.usuario_perfil.some((a) => a.centro_id === filtroCentro))
    && (!filtroPerfil || u.usuario_perfil.some((a) => a.perfil_id === filtroPerfil))
    && (sp.estado === "inactivos" ? !u.activo : sp.estado === "configurar" ? sinPerfil(u) : sp.estado === "sin_centro" ? sinCentro(u)
      : sp.estado === "todos" ? true : u.activo || sinPerfil(u)));
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const pag = Math.min(paginas, Math.max(1, Number(sp.pag) || 1));
  const pagina = filtradas.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA);
  const enlace = (n: number) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ver: "personas", pag: String(n) })
      .filter(([k, v]) => v && k !== "ok" && k !== "error") as [string, string][]);
    return `/admin?${p}`;
  };
  const cuenta = (pf: number) => usuarios.filter((u) => u.activo && u.usuario_perfil.some((a) => a.perfil_id === pf)).length;

  return <>
    <div className="admin-resumen">
      {puestos.map((p) => <Link key={p.id} href={`/admin?ver=personas&perfil=${p.id}`} className="admin-resumen-cifra">
        <b>{cuenta(p.id)}</b><span>{p.nombre}</span></Link>)}
      <Link href="/admin?ver=personas&estado=configurar" className={`admin-resumen-cifra ${porConfigurar.length ? "atencion" : ""}`}>
        <b>{porConfigurar.length}</b><span>Por configurar</span></Link>
    </div>

    {porConfigurar.length > 0 && sp.estado !== "inactivos" && <section className="panel por-configurar" id="por-configurar">
      <h2>Personas por configurar ({porConfigurar.length})</h2>
      <p className="hint">Han entrado (con Google, Microsoft o código) pero no tienen puesto: no ven nada y lo que pidan no le llega a nadie.
        Márcalas, elige su puesto y su centro y quedan activas de una vez.</p>
      <form action={configurarVarios}>
        <ul className="admin-marcar">
          {porConfigurar.map((u) => <li key={u.id}><label>
            <input type="checkbox" name="ids" value={u.id} defaultChecked={porConfigurar.length <= 5} />
            <span><b>{u.nombre || "(sin nombre)"}</b><small>{acceso(u)} · desde el {new Date(u.creado).toLocaleDateString("es-ES")}</small></span>
          </label></li>)}
        </ul>
        <div className="fila-form">
          <ElegirPerfilCentro id="varios" perfiles={puestos} centros={centros} obligatorio etiqueta="Puesto" />
          <button className="btn primario">Activar a las marcadas</button>
        </div>
      </form>
    </section>}

    <section className="panel">
      <form className="filtros" method="get" action="/admin">
        <input type="hidden" name="ver" value="personas" />
        <div className="crece"><label htmlFor="p-q">Buscar</label><input id="p-q" name="q" defaultValue={sp.q ?? ""} placeholder="Nombre, correo o código" /></div>
        <div><label htmlFor="p-c">Centro</label><select id="p-c" name="centro" defaultValue={filtroCentro ?? ""}>
          <option value="">Todos</option>{centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
        <div><label htmlFor="p-p">Perfil</label><select id="p-p" name="perfil" defaultValue={filtroPerfil ?? ""}>
          <option value="">Todos</option>{perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></div>
        <div><label htmlFor="p-e">Estado</label><select id="p-e" name="estado" defaultValue={sp.estado ?? ""}>
          <option value="">Activas</option><option value="configurar">Por configurar</option><option value="sin_centro">Sin centro</option>
          <option value="inactivos">Desactivadas</option><option value="todos">Todas</option></select></div>
        <button className="btn">Buscar</button>
      </form>
      <p className="hint">{filtradas.length} {filtradas.length === 1 ? "persona" : "personas"}{paginas > 1 ? ` · página ${pag} de ${paginas}` : ""}.
        Lo que ve y puede hacer cada persona es la suma de su puesto y sus complementos.</p>
      <div className="cm-tabla-caja"><table className="admin-personas">
        <thead><tr><th>Persona</th><th>Puesto y complementos</th><th>Estado</th><th><span className="sr-only">Editar</span></th></tr></thead>
        <tbody>{pagina.map((u) => <tr key={u.id}>
          <td><b>{u.nombre || "(sin nombre)"}</b><br /><span className="hint">{acceso(u)}</span></td>
          <td>
            {u.usuario_perfil.length === 0 && <span className="hint">{u.es_admin ? "Superadministrador (todo)" : "Ninguno"}</span>}
            <div className="admin-chips">{u.usuario_perfil.map((a) => {
              const pf = perfilDe.get(a.perfil_id);
              return <form key={a.id} action={quitarPerfil} className={`admin-chip ${pf?.pantalla ? "puesto" : ""}`}>
                <input type="hidden" name="asignacion" value={a.id} />
                <span>{pf?.nombre ?? "?"} · {a.centro_id ? nombreCentro.get(a.centro_id) : pf?.todos_los_centros ? "todos los centros" : <b className="cm-mal">sin centro</b>}</span>
                <button aria-label={`Quitar ${pf?.nombre}`} title="Quitar">×</button>
              </form>;
            })}</div>
          </td>
          <td>{u.activo ? <span className="etiqueta ok">Activa</span> : <span className="etiqueta">Desactivada</span>}
            {u.es_admin && <span className="etiqueta" style={{ marginLeft: 6 }}>Superadmin</span>}
            {!u.odoo_employee_id && !u.es_admin && <span className="etiqueta pronto" style={{ marginLeft: 6 }} title="Sin enlazar con su ficha de empleado: sus fichajes no llegan a Odoo">Sin Odoo</span>}</td>
          <td><details className="admin-editar">
            <summary>Editar</summary>
            <form action={cambiarPuesto} className="fila-form">
              <input type="hidden" name="id" value={u.id} />
              <ElegirPerfilCentro id={`pu-${u.id}`} perfiles={puestos} centros={centros} etiqueta="Puesto" />
              <button className="btn">Cambiar puesto</button>
            </form>
            {complementos.length > 0 && <form action={asignarPerfil} className="fila-form">
              <input type="hidden" name="id" value={u.id} />
              <ElegirPerfilCentro id={`co-${u.id}`} perfiles={complementos} centros={centros} etiqueta="Añadir complemento" />
              <button className="btn">Añadir</button>
            </form>}
            <form action={guardarUsuario} style={{ marginTop: 14 }}>
              <input type="hidden" name="id" value={u.id} />
              <div className="fila-form">
                <div><label>Nombre</label><input name="nombre" defaultValue={u.nombre} /></div>
                <div><label>Id de empleado en Odoo</label>
                  <input name="odoo_employee_id" inputMode="numeric" defaultValue={u.odoo_employee_id ?? ""} placeholder="Se rellena solo al sincronizar" /></div>
              </div>
              <div className="chips" style={{ marginTop: 12 }}>
                <label><input type="checkbox" name="activo" defaultChecked={u.activo} /> Activa</label>
                {esAdmin && <label><input type="checkbox" name="es_admin" defaultChecked={u.es_admin} /> Superadministrador (todo)</label>}
              </div>
              <button className="btn primario" style={{ marginTop: 14 }}>Guardar</button>
            </form>
            {u.codigo && <form action={cambiarPin} className="fila-form" style={{ marginTop: 14 }}>
              <input type="hidden" name="id" value={u.id} />
              <div><label>Nuevo PIN</label><input name="pin" type="password" inputMode="numeric" autoComplete="new-password" /></div>
              <button className="btn">Cambiar PIN</button>
            </form>}
          </details></td>
        </tr>)}</tbody>
      </table></div>
      {paginas > 1 && <nav className="paginas" aria-label="Páginas">
        {pag > 1 && <Link href={enlace(pag - 1)} className="btn pequeno">Anterior</Link>}
        <span>Página {pag} de {paginas}</span>
        {pag < paginas && <Link href={enlace(pag + 1)} className="btn pequeno">Siguiente</Link>}
      </nav>}
    </section>

    <section className="panel">
      <details>
        <summary><h2 className="en-linea">Alta con código y PIN (sin correo)</h2></summary>
        <p className="hint">Para quien no tiene cuenta de Google ni de Microsoft. Lo normal: que entre con Google y aparezca arriba, en «Por configurar».</p>
        <form action={crearUsuarioPin}>
          <div className="fila-form">
            <div><label>Nombre</label><input name="nombre" required /></div>
            <div><label>Código</label><input name="codigo" required autoCapitalize="characters" /></div>
            <div><label>PIN (6 a 12 cifras)</label><input name="pin" type="password" inputMode="numeric" autoComplete="new-password" required /></div>
            <ElegirPerfilCentro id="pin" perfiles={puestos} centros={centros} obligatorio etiqueta="Puesto" />
          </div>
          <button className="btn primario" style={{ marginTop: 14 }}>Crear usuario</button>
        </form>
      </details>
    </section>
  </>;
}

/* ---------------------------------------------------------------- perfiles */
async function Perfiles({ perfiles }: { perfiles: PerfilRol[] }) {
  const { supabase } = await conPermiso("admin.usuarios");
  const { data } = await supabase.from("usuario_perfil").select("perfil_id").returns<{ perfil_id: number }[]>();
  const usos = new Map<number, number>();
  for (const a of data ?? []) usos.set(a.perfil_id, (usos.get(a.perfil_id) ?? 0) + 1);
  return <section className="panel">
    <div className="normas">
      <b>Normas</b>
      <ul>
        <li>Hay <b>cuatro perfiles básicos</b>, que no se pueden borrar: <b>Administrador</b> (cuadro de mando de dirección),
          <b> Oficina</b> (espacio de gestión), <b>Chófer</b> y <b>Operario</b> (una sola pantalla en el móvil).</li>
        <li>Cada persona tiene <b>un puesto en su centro</b>. Encima se le pueden sumar <b>complementos</b>:
          <b> Responsable</b> (aprueba vacaciones y ropa y corrige fichajes de <b>su centro</b>) o <b>Seguridad</b> (todos los centros).</li>
        <li>Nadie aprueba lo suyo. A cada uno le llega lo suyo en la campana de arriba («Pendientes»).</li>
        <li>Al cambiar un perfil, cambia para todas las personas que lo tienen.</li>
      </ul>
    </div>
    {perfiles.map((p) => <details key={p.id} className="perfil">
      <summary><b>{p.nombre}</b>{p.base && <span className="etiqueta" style={{ marginLeft: 8 }}>Básico</span>}
        <span className="hint"> · {p.pantalla ? `Puesto · ${NOMBRE_PANTALLA[p.pantalla].split(":")[0]}` : "Complemento"} · {usos.get(p.id) ?? 0} personas ·
          {" "}{p.permisos.length} permisos{p.todos_los_centros && " · todos los centros"}</span></summary>
      <form action={guardarPerfil}>
        <input type="hidden" name="id" value={p.id} />
        <CamposPerfil p={p} />
        <button className="btn primario" style={{ marginTop: 14 }}>Guardar perfil</button>
      </form>
      {!p.base && <form action={borrarPerfil} className="chips" style={{ marginTop: 14, alignItems: "center" }}>
        <input type="hidden" name="id" value={p.id} />
        <label><input type="checkbox" name="confirmar" /> Sí, quiero borrarlo ({usos.get(p.id) ?? 0} personas lo perderán)</label>
        <button className="btn pequeno">Borrar perfil</button>
      </form>}
    </details>)}
    <details className="perfil">
      <summary><b>+ Nuevo perfil</b></summary>
      <form action={crearPerfil}><CamposPerfil /><button className="btn primario" style={{ marginTop: 14 }}>Crear perfil</button></form>
    </details>
  </section>;
}

/* ---------------------------------------------------------------- centros y su analítica de Odoo */
type Catalogo = { modo: string; cuentas: { id: number; nombre: string; codigo: string | null; empresa: string | null }[] | null;
  etiquetas: { id: number; nombre: string }[] | null; avisos: string[] };

async function ElegirAnalitica({ centro, usadas }: { centro: number; usadas: Set<string> }) {
  const { datos, error } = await llamarPythonDetalle<Catalogo>("/api/odoo/analitica", { espera: 20000 });
  if (!datos) return <p className="hint">No se ha podido leer la analítica de Odoo: {error}</p>;
  const cuentas = (datos.cuentas ?? []).filter((c) => !usadas.has(`cuenta:${c.id}`));
  const etiquetas = (datos.etiquetas ?? []).filter((e) => !usadas.has(`etiqueta:${e.id}`));
  if (!cuentas.length && !etiquetas.length) return <p className="hint">{datos.avisos[0] ?? "Odoo no tiene más cuentas ni etiquetas analíticas libres."}</p>;
  return <form action={asignarAnalitica} className="fila-form">
    <input type="hidden" name="centro" value={centro} />
    <div className="crece"><label htmlFor={`an-${centro}`}>Añadir cuenta o etiqueta analítica{datos.modo === "simulado" ? " (Odoo simulado)" : ""}</label>
      <select id={`an-${centro}`} name="analitica" defaultValue="" required>
        <option value="" disabled>Elige…</option>
        <optgroup label="Cuentas analíticas">{cuentas.map((c) => <option key={c.id} value={`cuenta:${c.id}:${c.nombre}`}>
          {c.codigo ? `[${c.codigo}] ` : ""}{c.nombre}{c.empresa ? ` · ${c.empresa}` : ""}</option>)}</optgroup>
        <optgroup label="Etiquetas analíticas">{etiquetas.map((e) => <option key={e.id} value={`etiqueta:${e.id}:${e.nombre}`}>{e.nombre}</option>)}</optgroup>
      </select></div>
    <button className="btn">Añadir</button>
  </form>;
}

async function Centros({ centros }: { centros: Centro[] }) {
  const { supabase } = await conPermiso("admin.usuarios");
  const { data } = await supabase.from("centro_analitica").select("id,centro_id,tipo,odoo_id,nombre").order("nombre")
    .returns<{ id: number; centro_id: number; tipo: string; odoo_id: number; nombre: string }[]>();
  const usadas = new Set((data ?? []).map((a) => `${a.tipo}:${a.odoo_id}`));
  return <>
    <p className="lead">Para separar ingresos, gastos y margen por centro, di qué <b>cuentas o etiquetas analíticas</b> de Odoo son de cada uno
      (las que llevan sus viajes y sus facturas). Una cuenta o etiqueta solo puede ser de un centro.</p>
    {centros.map((c) => {
      const suyas = (data ?? []).filter((a) => a.centro_id === c.id);
      return <section key={c.id} className="panel admin-centro">
        <div className="admin-centro-cabecera"><h2>{c.nombre}</h2>
          {suyas.length ? <span className="etiqueta ok">Con analítica</span> : <span className="etiqueta pronto">Sin analítica</span>}</div>
        {suyas.length > 0 && <div className="admin-chips">{suyas.map((a) => <form key={a.id} action={quitarAnalitica} className="admin-chip">
          <input type="hidden" name="id" value={a.id} />
          <span>{a.tipo === "cuenta" ? "Cuenta" : "Etiqueta"} · {a.nombre}</span><button aria-label={`Quitar ${a.nombre}`} title="Quitar">×</button>
        </form>)}</div>}
        <Suspense fallback={<p className="hint">Consultando la analítica de Odoo…</p>}><ElegirAnalitica centro={c.id} usadas={usadas} /></Suspense>
      </section>;
    })}
    <section className="panel">
      <form action={crearCentro} className="fila-form">
        <div className="crece"><label htmlFor="c-nuevo">Nuevo centro</label><input id="c-nuevo" name="nombre" placeholder="Ej.: Oficina Valencia" /></div>
        <button className="btn">Añadir centro</button>
      </form>
    </section>
  </>;
}

/* ---------------------------------------------------------------- camiones */
async function Camiones({ centros }: { centros: Centro[] }) {
  const { supabase } = await conPermiso("vehiculos.gestionar");
  const { data: vehiculos } = await supabase.from("vehiculos").select("id,matricula,modelo,centro_id,activo").order("matricula")
    .returns<{ id: number; matricula: string; modelo: string | null; centro_id: number | null; activo: boolean }[]>();
  const nombreCentro = new Map(centros.map((c) => [c.id, c.nombre]));
  return <section className="panel">
    <h2>Camiones (cabezas tractoras)</h2>
    <p className="hint">Los conductores eligen o confirman su camión de esta lista. El centro de flota consulta directamente los vehículos de Movildata.
      La ITV, el seguro y la revisión del tacógrafo de cada camión se apuntan en <a href="/seguridad?ver=vehiculos">Seguridad → Vehículos</a>.</p>
    {(vehiculos ?? []).length > 0 && <table>
      <thead><tr><th>Matrícula</th><th>Modelo</th><th>Centro</th><th>Activo</th></tr></thead>
      <tbody>{(vehiculos ?? []).map((v) => <tr key={v.id}>
        <td><b>{v.matricula}</b></td><td>{v.modelo ?? "—"}</td><td>{v.centro_id ? nombreCentro.get(v.centro_id) : "—"}</td>
        <td><form action={cambiarVehiculo} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="hidden" name="id" value={v.id} />
          <input type="checkbox" name="activo" defaultChecked={v.activo} aria-label="Activo" />
          <button className="btn pequeno">Guardar</button>
        </form></td>
      </tr>)}</tbody>
    </table>}
    <form action={crearVehiculo} className="fila-form" style={{ marginTop: 12 }}>
      <div><label>Matrícula</label><input name="matricula" required autoCapitalize="characters" /></div>
      <div><label>Modelo</label><input name="modelo" /></div>
      <div><label>Centro</label><select name="centro" defaultValue=""><option value="">—</option>
        {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
      <button className="btn">Añadir camión</button>
    </form>
  </section>;
}
