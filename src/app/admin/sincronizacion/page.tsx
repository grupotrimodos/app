import Link from "next/link";
import Cabecera from "../../Cabecera";
import { fecha, hora, ESTADO_ODOO } from "@/lib/jornada";
import { llamarPythonDetalle } from "@/lib/python";
import { conPermiso } from "@/lib/usuario";
import { sincronizarAhora } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sincronización con Odoo · Grupo Trimodos" };

type Mapa = { id: string; nombre: string; nombre_app: string; modelo: string; sentido: "odoo_a_app" | "app_a_odoo"; que_hace: string;
  instalada: boolean | null };
type Paso = { estado: string; detalle?: string; aviso?: string; [k: string]: unknown };
type Estado = {
  modo_odoo: "real" | "simulado"; envio: "real" | "simulado"; automatica: boolean; mapas: Mapa[];
  pendientes: { fichajes: Record<string, number>; ausencias: Record<string, number>; sin_ficha: number };
  personas_sin_ficha: { id: string; nombre: string | null; codigo: string | null }[];
  errores: { tipo: string; persona: string; odoo_estado: string; odoo_error: string }[];
  ultima: { inicio: string; origen: string; modo: string; resultado: Record<string, Paso> } | null;
};

const NOMBRES_DATO: Record<string, string> = {
  enlazados: "enlazados", sin_ficha: "sin ficha", personas: "personas", enviados: "enviados", errores: "con error",
  sin_empleado: "sin ficha de empleado", enviado: "enviadas", simulado: "simuladas", error: "con error", en_odoo: "en Odoo",
  nuevos: "nuevos", matricula_cambiada: "con matrícula cambiada", no_aplica: "no aplica",
};

function resumen(p: Paso) {
  if (p.estado !== "ok") return p.detalle ?? p.estado;
  const partes = Object.entries(p).filter(([k, v]) => !["estado", "detalle", "aviso"].includes(k) && typeof v === "number")
    .map(([k, v]) => `${v} ${NOMBRES_DATO[k] ?? k}`);
  return [partes.join(" · ") || "Nada pendiente", p.aviso].filter(Boolean).join(". ");
}

function Instalada({ m }: { m: Mapa }) {
  if (m.instalada === true) return <span className="etiqueta ok">Instalada</span>;
  if (m.instalada === false) return <span className="etiqueta mal">No instalada: no se envía</span>;
  return <span className="etiqueta">No se puede comprobar: se intenta</span>;
}

export default async function Sincronizacion({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { perfil } = await conPermiso("admin.sincronizacion");
  const { ok, error } = await searchParams;
  const { datos: e, error: fallo } = await llamarPythonDetalle<Estado>("/api/odoo/estado", { espera: 15000 });
  const n = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.email || ""} />
      <main className="contenido">
        <p><Link href="/admin">← Administración</Link></p>
        <h1>Sincronización con Odoo</h1>
        <p className="lead">Cada dato va solo a su sitio en Odoo. No hay que elegir nada: aquí se ve qué va a dónde y si algo
          necesita que lo arregles.</p>
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {fallo && <p className="error" role="alert">{fallo}</p>}

        {e && <>
          {(e.modo_odoo === "simulado" || e.envio === "simulado") && (
            <p className="aviso">
              {e.modo_odoo === "simulado" ? "Odoo está en modo de prueba (simulado). " : ""}
              {e.envio === "simulado" ? "Los fichajes y ausencias se marcan como «simulado» y no llegan a Odoo." : ""}
            </p>
          )}

          <form action={sincronizarAhora} style={{ marginBottom: 16 }}>
            <button className="btn primario grande">Sincronizar ahora</button>
            <p className="hint">
              {e.automatica ? "También se hace sola cada día y al momento con cada fichaje o ausencia aprobada."
                : "Se hace al momento con cada fichaje o ausencia aprobada. La pasada diaria automática aún no está activada (falta CRON_SECRET)."}
            </p>
          </form>

          <div className="cifras">
            <div className="panel"><b>{n(e.pendientes.fichajes)}</b><span>Fichajes por enviar</span></div>
            <div className="panel"><b>{n(e.pendientes.ausencias)}</b><span>Ausencias por enviar</span></div>
            <div className="panel"><b>{e.pendientes.sin_ficha}</b><span>Personas sin ficha de empleado</span></div>
            <div className="panel"><b>{e.errores.length}</b><span>Con error</span></div>
          </div>

          <section className="panel">
            <h2>Qué va a dónde</h2>
            <table>
              <thead><tr><th>Dato</th><th>Sentido</th><th>En Odoo</th><th>Última pasada</th></tr></thead>
              <tbody>
                {e.mapas.map((m) => (
                  <tr key={m.id}>
                    <td><b>{m.nombre}</b><br /><span className="hint">{m.que_hace}</span></td>
                    <td>{m.sentido === "app_a_odoo" ? "App → Odoo" : "Odoo → App"}</td>
                    <td>{m.nombre_app}<br /><Instalada m={m} /></td>
                    <td>{e.ultima?.resultado[m.id] ? resumen(e.ultima.resultado[m.id]) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              {e.ultima ? <>Última pasada: {fecha(e.ultima.inicio)} a las {hora(e.ultima.inicio)} ({e.ultima.origen}, {e.ultima.modo}).</>
                : "Todavía no se ha hecho ninguna pasada."}
            </p>
          </section>

          {e.errores.length > 0 && (
            <section className="panel">
              <h2>Necesitan que lo arregles</h2>
              <ul className="lista-fichajes">
                {e.errores.map((x, i) => (
                  <li key={i}><b>{x.persona}</b> · {x.tipo} · <span className="etiqueta mal">{ESTADO_ODOO[x.odoo_estado] ?? x.odoo_estado}</span>
                    <br /><span className="hint">{x.odoo_error}</span></li>
                ))}
              </ul>
              <p className="hint">Cuando lo arregles (en Odoo o en la ficha de la persona), pulsa «Sincronizar ahora».</p>
            </section>
          )}

          {e.personas_sin_ficha.length > 0 && (
            <section className="panel">
              <h2>Personas sin ficha de empleado en Odoo</h2>
              <p className="hint">Se enlazan solas si en Odoo su ficha tiene el mismo <b>correo de trabajo</b> (quien entra con
                Microsoft) o su <b>código</b> en «Credencial» (quien entra con código y PIN). Si no, pon el id a mano en Administración.</p>
              <p>{e.personas_sin_ficha.map((p) => p.nombre || p.codigo || "—").join(" · ")}</p>
            </section>
          )}
        </>}
      </main>
    </>
  );
}
