import Link from "next/link";
import { Suspense } from "react";
import Icono from "./Icono";
import { fichar } from "./fichaje/acciones";
import { requiereAtencion, type ResumenFlota } from "@/lib/flota";
import { BOTON_TIPO, estadoDe, hora, inicioDia, NOMBRE_ESTADO, SIGUIENTES, type Fichaje } from "@/lib/jornada";
import { llamarPythonDetalle } from "@/lib/python";
import { createClient } from "@/lib/supabase/server";
import { permisosDe } from "@/lib/permisos";
import { usuarioActual } from "@/lib/usuario";

/** Cuadro de mando de dirección: cifras resumidas de toda la empresa (permiso «direccion.ver»). Las de personas y
 *  seguridad salen de public.resumen_direccion (solo totales); las comerciales, de Odoo; las de flota, de Movildata. */

type Centro = { nombre: string; plantilla: number; fichados: number; trabajando: number; ausentes: number;
  vacaciones_pendientes: number; ropa_pendiente: number; responsables: number };
type Resumen = {
  hoy: string; plantilla: number; fichados: number; trabajando: number; en_pausa: number; ausentes: number;
  choferes: number; choferes_trabajando: number; choferes_con_camion: number; sin_centro: number;
  por_puesto: { puesto: string; n: number }[]; centros: Centro[];
  pendientes: { vacaciones: number; ropa: number; ropa_entregar: number; por_configurar: number; odoo_error: number };
  seguridad: { caducados: number; pronto: number; faltan: number };
  incidencias: { abiertas: number; graves: number; mes: number };
};
type Comercial = {
  modo: "real" | "simulado"; actualizado: string; avisos: string[];
  crm: { abiertas: number; valor: number; por_etapa: { etapa: string; n: number; importe: number }[]; ganadas_mes: number; ganado_mes: number; nuevas_mes: number } | null;
  ventas: { mes: number; pedidos_mes: number; mismo_periodo_anterior: number } | null;
  facturacion: { mes: number; facturas_mes: number; por_cobrar: number; vencido: number; facturas_vencidas: number } | null;
  empresas: { empresa: string; ventas?: number; facturado?: number; por_cobrar?: number; vencido?: number }[];
};

const euros = (n: number | undefined | null) => n === undefined || n === null ? "—"
  : n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("es-ES"));

function Cifra({ titulo, valor, detalle, href, tono, barra }: {
  titulo: string; valor: string; detalle?: string; href?: string; tono?: "bien" | "atencion" | "alerta"; barra?: number;
}) {
  const contenido = <>
    <span className="cm-cifra-titulo">{titulo}</span>
    <strong>{valor}</strong>
    {barra !== undefined && <span className="cm-barra" aria-hidden="true"><i style={{ width: `${Math.min(100, barra)}%` }} /></span>}
    {detalle && <span className="cm-cifra-detalle">{detalle}</span>}
  </>;
  const clase = `cm-cifra ${tono ?? ""}`;
  return href ? <Link className={clase} href={href}>{contenido}</Link> : <div className={clase}>{contenido}</div>;
}

function Seccion({ titulo, nota, children, id }: { titulo: string; nota?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return <section className="cm-seccion" aria-labelledby={id}>
    <div className="cm-seccion-cabecera"><h2 id={id}>{titulo}</h2>{nota}</div>
    {children}
  </section>;
}

/** Comercial (Odoo): se pide aparte para que el resto del cuadro no espere a Odoo. */
async function BloqueComercial() {
  const { datos, error } = await llamarPythonDetalle<Comercial>("/api/odoo/comercial", { espera: 20000 });
  if (!datos) return <p className="cm-aviso">No se han podido leer los datos de Odoo: {error}</p>;
  const { crm, ventas, facturacion, empresas } = datos;
  const variacion = ventas && ventas.mismo_periodo_anterior > 0
    ? Math.round(((ventas.mes - ventas.mismo_periodo_anterior) / ventas.mismo_periodo_anterior) * 100) : null;
  const maxEtapa = Math.max(1, ...(crm?.por_etapa ?? []).map((e) => e.importe));
  return <>
    {datos.modo === "simulado" && <p className="cm-aviso">Datos de prueba: Odoo está en modo simulado. Con la conexión real aparecen vuestras cifras.</p>}
    {datos.avisos.map((a) => <p key={a} className="cm-aviso">{a}</p>)}
    <div className="cm-cifras">
      <Cifra titulo="Oportunidades abiertas" valor={crm ? euros(crm.valor) : "—"} detalle={crm ? `${num(crm.abiertas)} en el embudo` : "CRM no disponible"} />
      <Cifra titulo="Ganado este mes" valor={crm ? euros(crm.ganado_mes) : "—"} tono={crm && crm.ganadas_mes ? "bien" : undefined}
        detalle={crm ? `${crm.ganadas_mes} ganadas · ${crm.nuevas_mes} nuevas` : undefined} />
      <Cifra titulo="Ventas del mes" valor={ventas ? euros(ventas.mes) : "—"} tono={variacion !== null && variacion < 0 ? "atencion" : undefined}
        detalle={ventas ? `${num(ventas.pedidos_mes)} pedidos${variacion !== null ? ` · ${variacion >= 0 ? "+" : ""}${variacion} % vs. mes anterior` : ""}` : undefined} />
      <Cifra titulo="Facturado este mes" valor={facturacion ? euros(facturacion.mes) : "—"}
        detalle={facturacion ? `${num(facturacion.facturas_mes)} facturas (sin IVA)` : undefined} />
      <Cifra titulo="Pendiente de cobro" valor={facturacion ? euros(facturacion.por_cobrar) : "—"}
        tono={facturacion && facturacion.vencido > 0 ? "alerta" : undefined}
        detalle={facturacion ? `${euros(facturacion.vencido)} vencido (${facturacion.facturas_vencidas} facturas)` : undefined} />
    </div>
    <div className="cm-dos">
      {crm && crm.por_etapa.length > 0 && <div className="cm-panel">
        <h3>Embudo de ventas</h3>
        <ul className="cm-barras">
          {crm.por_etapa.map((e) => <li key={e.etapa}>
            <span className="cm-barras-etiqueta">{e.etapa}<small>{e.n} {e.n === 1 ? "oportunidad" : "oportunidades"}</small></span>
            <span className="cm-barras-pista"><i style={{ width: `${(e.importe / maxEtapa) * 100}%` }} /></span>
            <span className="cm-barras-valor">{euros(e.importe)}</span>
          </li>)}
        </ul>
      </div>}
      {empresas.length > 0 && <div className="cm-panel">
        <h3>Por empresa · este mes</h3>
        <div className="cm-tabla-caja"><table className="cm-tabla">
          <thead><tr><th>Empresa</th><th>Ventas</th><th>Facturado</th><th>Por cobrar</th><th>Vencido</th></tr></thead>
          <tbody>{empresas.map((e) => <tr key={e.empresa}>
            <td><b>{e.empresa}</b></td><td>{euros(e.ventas ?? 0)}</td><td>{euros(e.facturado ?? 0)}</td>
            <td>{euros(e.por_cobrar ?? 0)}</td><td className={e.vencido ? "cm-mal" : ""}>{euros(e.vencido ?? 0)}</td>
          </tr>)}</tbody>
        </table></div>
      </div>}
    </div>
  </>;
}

/** Flota (Movildata), también aparte. */
async function BloqueFlota({ aFlota }: { aFlota?: string }) {
  const { datos, error } = await llamarPythonDetalle<ResumenFlota>("/api/flota/resumen", { espera: 20000 });
  const v = datos?.vehiculos ?? [];
  const suma = (k: "km_hoy" | "consumo_hoy_litros") => {
    const x = v.map((y) => y[k]).filter((n): n is number => n !== null && Number.isFinite(n));
    return x.length ? x.reduce((a, b) => a + b, 0) : null;
  };
  const km = suma("km_hoy"), litros = suma("consumo_hoy_litros"), atencion = v.filter(requiereAtencion).length;
  return <>
    {!datos && <p className="cm-aviso">Movildata no responde: {error}</p>}
    {datos?.simulado && <p className="cm-aviso">Flota en modo de prueba.</p>}
    <div className="cm-cifras">
      <Cifra titulo="Vehículos en movimiento" valor={datos ? `${v.filter((y) => y.estado === "en_ruta").length} de ${v.length}` : "—"} href={aFlota} />
      <Cifra titulo="Kilómetros hoy" valor={km === null ? "—" : `${km.toLocaleString("es-ES", { maximumFractionDigits: 0 })} km`} href={aFlota}
        detalle={litros === null ? undefined : `${litros.toLocaleString("es-ES", { maximumFractionDigits: 0 })} L de gasóleo`} />
      <Cifra titulo="Vehículos con aviso" valor={datos ? String(atencion) : "—"} href={aFlota} tono={atencion ? "atencion" : undefined}
        detalle="Señal antigua, poco combustible u otros" />
    </div>
  </>;
}

const Cargando = ({ texto }: { texto: string }) => <p className="cm-cargando">{texto}</p>;

export default async function CuadroDeMando({ uid, puedeFichar, herramientas }: { uid: string; puedeFichar: boolean; herramientas: React.ReactNode }) {
  const supabase = await createClient();
  const { puede } = await usuarioActual();
  // Una cifra solo es enlace si quien mira puede abrir esa pantalla (si no, le devolvería al inicio).
  const si = (href: string, ...ps: string[]) => (puede(...ps) ? href : undefined);
  const a = {
    admin: si("/admin", "admin.usuarios", "vehiculos.gestionar", "admin.sincronizacion"), equipo: si("/equipo", ...permisosDe("equipo")),
    flota: si("/flota", "flota.ver"), ropa: si("/ropa", ...permisosDe("ropa")), seguridad: si("/seguridad", "seguridad.ver", "seguridad.gestionar"),
    incidencias: si("/seguridad?ver=incidencias", "seguridad.ver", "seguridad.gestionar"), configurar: si("/admin#por-configurar", "admin.usuarios"),
    sincronizacion: si("/admin/sincronizacion", "admin.sincronizacion"),
  };
  const [{ data, error }, { data: mios }] = await Promise.all([
    supabase.rpc("resumen_direccion"),
    puedeFichar ? supabase.from("fichajes").select("tipo,momento").eq("usuario_id", uid).gte("momento", inicioDia(1).toISOString()).order("momento")
      : Promise.resolve({ data: [] }),
  ]);
  const ahora = new Date();
  const fechaTexto = ahora.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" });
  const estado = estadoDe((mios ?? []) as Fichaje[]);
  const r = data as Resumen | null;

  return <div className="cm">
    <header className="cm-cabecera">
      <div>
        <p className="inicio-antetitulo">GRUPO TRIMODOS · DIRECCIÓN</p>
        <h1>Cuadro de mando</h1>
        <p className="cm-fecha"><span>{fechaTexto}</span> · datos de hoy a las {hora(ahora.toISOString())}</p>
      </div>
      {puedeFichar && <div className="cm-mi-jornada" aria-label="Mi jornada">
        <span className={`inicio-estado ${estado}`}><i />{NOMBRE_ESTADO[estado]}</span>
        {SIGUIENTES[estado].map((t) => <form key={t} action={fichar}>
          <input type="hidden" name="tipo" value={t} /><input type="hidden" name="volver" value="/" />
          <button className="btn pequeno">{BOTON_TIPO[t]}</button>
        </form>)}
        <Link href="/fichaje" className="cm-enlace">Mi jornada</Link>
      </div>}
    </header>

    {!r ? <p className="error">No se ha podido cargar el cuadro de mando{error ? `: ${error.message}` : ""}.</p> : <>
      <div className="cm-cifras cm-cifras-clave">
        <Cifra titulo="Plantilla activa" valor={num(r.plantilla)} href={a.admin} detalle={`${r.sin_centro ? `${r.sin_centro} sin centro · ` : ""}${r.centros.length} centros`} />
        <Cifra titulo="Han fichado hoy" valor={`${num(r.fichados)}`} barra={pct(r.fichados, r.plantilla - r.ausentes)}
          detalle={`${pct(r.fichados, r.plantilla - r.ausentes)} % de quien trabaja hoy`} href={a.equipo} />
        <Cifra titulo="Trabajando ahora" valor={num(r.trabajando)} href={a.equipo} tono={r.trabajando ? "bien" : undefined}
          detalle={r.en_pausa ? `y ${r.en_pausa} en pausa` : "Nadie en pausa"} />
        <Cifra titulo="Ausentes hoy" valor={num(r.ausentes)} href={a.equipo} detalle="Vacaciones y permisos aprobados" />
        <Cifra titulo="Chóferes en ruta" valor={`${num(r.choferes_trabajando)} / ${num(r.choferes)}`} href={a.flota}
          barra={pct(r.choferes_trabajando, r.choferes)} detalle={`${r.choferes_con_camion} con camión confirmado`} />
        {(() => {
          const p = r.pendientes, total = p.vacaciones + p.ropa + p.ropa_entregar + p.por_configurar + p.odoo_error;
          return <Cifra titulo="Por resolver" valor={num(total)} href="/pendientes" tono={total ? "atencion" : "bien"}
            detalle={total ? "Vacaciones, ropa, altas y Odoo" : "Todo al día"} />;
        })()}
      </div>

      <div className="cm-dos cm-dos-ancho">
        <Seccion titulo="Personas por centro" id="cm-centros">
          <div className="cm-panel"><div className="cm-tabla-caja"><table className="cm-tabla">
            <thead><tr><th>Centro</th><th>Plantilla</th><th>Han fichado</th><th>Trabajando</th><th>Ausentes</th><th>Por aprobar</th><th>Responsable</th></tr></thead>
            <tbody>
              {r.centros.map((c) => <tr key={c.nombre} className={c.plantilla ? "" : "cm-vacio"}>
                <td><b>{c.nombre}</b></td><td>{c.plantilla}</td>
                <td>{c.plantilla ? <>{c.fichados} <small>({pct(c.fichados, c.plantilla - c.ausentes)} %)</small></> : "—"}</td>
                <td>{c.trabajando}</td><td>{c.ausentes}</td>
                <td className={c.vacaciones_pendientes + c.ropa_pendiente ? "cm-atencion" : ""}>{c.vacaciones_pendientes + c.ropa_pendiente}</td>
                <td>{c.responsables ? <span className="etiqueta ok">{c.responsables}</span>
                  : c.plantilla ? <span className="etiqueta pronto">Sin responsable</span> : <span className="cm-gris">—</span>}</td>
              </tr>)}
              {r.sin_centro > 0 && <tr><td><b>Sin centro</b></td><td>{r.sin_centro}</td><td colSpan={5}>
                {a.admin ? <Link href={a.admin}>Asígnales un centro</Link> : "Hay que asignarles un centro"}: sus solicitudes solo las ve la administración.</td></tr>}
            </tbody>
          </table></div></div>
        </Seccion>
        <Seccion titulo="Por resolver" id="cm-pendientes">
          <div className="cm-panel"><ul className="cm-lista">
            {([["Vacaciones por aprobar", r.pendientes.vacaciones, a.equipo], ["Ropa por aprobar", r.pendientes.ropa, a.ropa],
              ["Ropa por entregar", r.pendientes.ropa_entregar, a.ropa], ["Personas por configurar", r.pendientes.por_configurar, a.configurar],
              ["Envíos a Odoo con error", r.pendientes.odoo_error, a.sincronizacion]] as const).map(([texto, n, href]) => {
              const fila = <><span>{texto}</span><b className={n && texto.startsWith("Envíos") ? "cm-mal" : ""}>{n}</b></>;
              return <li key={texto}>{href ? <Link href={href}>{fila}</Link> : <div className="cm-lista-fila">{fila}</div>}</li>;
            })}
          </ul></div>
        </Seccion>
      </div>

      <Seccion titulo="Comercial" id="cm-comercial" nota={<span className="cm-nota">Odoo · CRM, ventas y facturación · sin IVA</span>}>
        <Suspense fallback={<Cargando texto="Consultando Odoo…" />}><BloqueComercial /></Suspense>
      </Seccion>

      <Seccion titulo="Flota" id="cm-operacion" nota={<span className="cm-nota">Movildata · ahora</span>}>
        <Suspense fallback={<Cargando texto="Consultando Movildata…" />}><BloqueFlota aFlota={a.flota} /></Suspense>
      </Seccion>

      <div className="cm-dos">
        <Seccion titulo="Seguridad y cumplimiento" id="cm-seguridad">
          <div className="cm-cifras cm-cifras-tres">
            <Cifra titulo="Caducados" valor={num(r.seguridad.caducados)} href={a.seguridad} tono={r.seguridad.caducados ? "alerta" : "bien"}
              detalle="ITV, seguros, carnés, revisiones" />
            <Cifra titulo="Sin apuntar" valor={num(r.seguridad.faltan)} href={a.seguridad} tono={r.seguridad.faltan ? "atencion" : undefined}
              detalle="Documentación que nadie ha rellenado" />
            <Cifra titulo="Caducan en 30 días" valor={num(r.seguridad.pronto)} href={a.seguridad} />
            <Cifra titulo="Incidencias abiertas" valor={num(r.incidencias.abiertas)} href={a.incidencias}
              tono={r.incidencias.graves ? "alerta" : r.incidencias.abiertas ? "atencion" : undefined}
              detalle={`${r.incidencias.graves} graves · ${r.incidencias.mes} este mes`} />
          </div>
        </Seccion>
        <Seccion titulo="Plantilla por puesto" id="cm-puestos">
          <div className="cm-panel">{r.por_puesto.length === 0 ? <p className="hint">Nadie tiene perfil todavía.</p> : <ul className="cm-barras">
            {r.por_puesto.map((p) => <li key={p.puesto}>
              <span className="cm-barras-etiqueta">{p.puesto}</span>
              <span className="cm-barras-pista"><i style={{ width: `${(p.n / Math.max(...r.por_puesto.map((x) => x.n))) * 100}%` }} /></span>
              <span className="cm-barras-valor">{p.n}</span>
            </li>)}
          </ul>}</div>
        </Seccion>
      </div>
    </>}

    <Seccion titulo="Herramientas" id="cm-herramientas">{herramientas}</Seccion>
    <p className="cm-pie"><Icono nombre="escudo" size={15} /> Solo totales: el detalle de cada persona está en su pantalla, con sus permisos.</p>
  </div>;
}
