import Link from "next/link";
import Cabecera from "../../Cabecera";
import { asignarZonas, cambiarZona, crearZona } from "./acciones";
import { centrosConPermiso, conPermiso } from "@/lib/usuario";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chóferes por cliente o ruta · Grupo Trimodos" };

type Zona = { id: number; nombre: string; tipo: "cliente" | "ruta"; descripcion: string | null; activo: boolean };
type Fila = { usuario_id: string; centro_id: number | null; perfiles: { permisos: string[] } | null;
  usuarios: { nombre: string; codigo: string | null; email: string | null; activo: boolean } | null };

/** Zonas = clientes o rutas. Cada chófer de sus centros tiene una; el cuadro de mando separa a los chóferes por ellas. */
export default async function Zonas({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; centro?: string; q?: string; sin?: string }> }) {
  const { supabase, uid, perfil } = await conPermiso("zonas.gestionar");
  const { ok, error, centro, q, sin } = await searchParams;
  const [{ data: zonas }, { data: filas }, centros] = await Promise.all([
    supabase.from("zonas").select("id,nombre,tipo,descripcion,activo").order("nombre").returns<Zona[]>(),
    // La base de datos devuelve solo las personas de los centros en los que puede organizar zonas.
    supabase.from("usuario_perfil").select("usuario_id,centro_id,perfiles(permisos),usuarios(nombre,codigo,email,activo)").returns<Fila[]>(),
    centrosConPermiso(supabase, uid, perfil.es_admin, ["zonas.gestionar"]),
  ]);
  const choferes = new Map<string, { id: string; nombre: string; centro: number | null }>();
  for (const f of filas ?? []) {
    if (!f.usuarios?.activo || !f.perfiles?.permisos.includes("chofer.usar")) continue;
    choferes.set(f.usuario_id, { id: f.usuario_id, nombre: f.usuarios.nombre || f.usuarios.codigo || f.usuarios.email || "—",
      centro: choferes.get(f.usuario_id)?.centro ?? f.centro_id });
  }
  const ids = [...choferes.keys()];
  const { data: asignadas } = ids.length
    ? await supabase.from("chofer_zona").select("usuario_id,zona_id").in("usuario_id", ids).returns<{ usuario_id: string; zona_id: number }[]>()
    : { data: [] };
  const zonaDe = new Map((asignadas ?? []).map((a) => [a.usuario_id, a.zona_id]));
  const nombreCentro = new Map(centros.map((c) => [c.id, c.nombre]));
  const activas = (zonas ?? []).filter((z) => z.activo);
  const cuantos = (z: number) => [...zonaDe.values()].filter((x) => x === z).length;
  const filtroCentro = Number(centro) || null;
  const texto = (q ?? "").trim().toLowerCase();
  const lista = [...choferes.values()]
    .filter((c) => (!filtroCentro || c.centro === filtroCentro) && (!texto || c.nombre.toLowerCase().includes(texto)) && (!sin || !zonaDe.has(c.id)))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const sinZona = [...choferes.values()].filter((c) => !zonaDe.has(c.id)).length;

  return <>
    <Cabecera nombre={perfil.nombre || perfil.email || ""} />
    <main className="contenido">
      <p className="inicio-antetitulo"><Link href="/equipo">Mi equipo</Link> · ZONAS</p>
      <h1>Chóferes por cliente o ruta</h1>
      <p className="lead">Agrupa a los chóferes por el cliente o la ruta para la que trabajan. Dirección los ve así en el cuadro de mando:
        cuántos están activos, quién ha fichado y si tienen la documentación al día.</p>
      {ok && <p className="aviso" role="status">{ok}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="cm-dos zonas-dos">
        <section className="panel">
          <h2>Zonas ({activas.length})</h2>
          {(zonas ?? []).length === 0 ? <p className="hint">Todavía no hay ninguna. Crea la primera aquí abajo.</p> : <ul className="zonas-lista">
            {(zonas ?? []).map((z) => <li key={z.id} className={z.activo ? "" : "retirada"}>
              <div><b>{z.nombre}</b> <span className="etiqueta">{z.tipo === "ruta" ? "Ruta" : "Cliente"}</span>
                {z.descripcion && <span className="hint"> · {z.descripcion}</span>}</div>
              <span className="hint">{cuantos(z.id)} chóferes</span>
              <form action={cambiarZona}><input type="hidden" name="id" value={z.id} /><input type="hidden" name="activo" value={z.activo ? "0" : "1"} />
                <button className="btn pequeno">{z.activo ? "Retirar" : "Activar"}</button></form>
            </li>)}
          </ul>}
          <form action={crearZona} className="zonas-nueva">
            <h3>Nueva zona</h3>
            <div className="fila-form">
              <div><label htmlFor="z-nombre">Cliente o ruta</label><input id="z-nombre" name="nombre" required maxLength={80} placeholder="Ej.: Carburos Metálicos" /></div>
              <div><label htmlFor="z-tipo">Es un…</label><select id="z-tipo" name="tipo" defaultValue="cliente">
                <option value="cliente">Cliente</option><option value="ruta">Ruta</option></select></div>
            </div>
            <label htmlFor="z-desc">Descripción (opcional)</label>
            <input id="z-desc" name="descripcion" maxLength={200} placeholder="Ej.: Castellón – Tarragona, ida y vuelta diaria" />
            <button className="btn primario" style={{ marginTop: 14 }}>Crear zona</button>
          </form>
        </section>

        <section className="panel">
          <h2>Chóferes ({choferes.size}){sinZona > 0 && <span className="etiqueta pronto" style={{ marginLeft: 10 }}>{sinZona} sin zona</span>}</h2>
          <form className="filtros" method="get">
            <div><label htmlFor="f-q">Buscar</label><input id="f-q" name="q" defaultValue={q ?? ""} placeholder="Nombre" /></div>
            {centros.length > 1 && <div><label htmlFor="f-c">Centro</label><select id="f-c" name="centro" defaultValue={filtroCentro ?? ""}>
              <option value="">Todos</option>{centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>}
            <label className="chips"><span><input type="checkbox" name="sin" value="1" defaultChecked={!!sin} /> Solo sin zona</span></label>
            <button className="btn">Filtrar</button>
          </form>
          {lista.length === 0 ? <p className="hint">{choferes.size ? "Nadie con ese filtro." : "No hay chóferes en tus centros."}</p>
            : activas.length === 0 ? <p className="hint">Crea primero una zona para poder asignarla.</p>
            : <form action={asignarZonas}>
              <ul className="zonas-choferes">
                {lista.map((c) => <li key={c.id}>
                  <span><b>{c.nombre}</b><small>{c.centro ? nombreCentro.get(c.centro) ?? "" : "Sin centro"}</small></span>
                  <input type="hidden" name={`antes_${c.id}`} value={zonaDe.get(c.id) ?? ""} />
                  <select name={`zona_${c.id}`} defaultValue={zonaDe.get(c.id) ?? ""} aria-label={`Zona de ${c.nombre}`}>
                    <option value="">Sin zona</option>
                    {activas.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
                  </select>
                </li>)}
              </ul>
              <button className="btn primario ancho" style={{ marginTop: 14 }}>Guardar cambios</button>
            </form>}
        </section>
      </div>
    </main>
  </>;
}
