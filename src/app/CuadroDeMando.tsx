import Link from "next/link";
import { cache, Suspense } from "react";
import Icono from "./Icono";
import { hora } from "@/lib/jornada";
import { permisosDe } from "@/lib/permisos";
import { llamarPythonDetalle } from "@/lib/python";
import { nombreTemporada } from "@/lib/ropa";
import { usuarioActual } from "@/lib/usuario";

/**
 * Cuadro de mando de dirección. Pestañas: Resumen (alertas y cifras clave), Finanzas (facturación, cobros, pagos y
 * pendiente de facturar), Centros y zonas, Comercial y Personas. Sin fichaje ni flota: eso es del día a día.
 * Personas y seguridad salen de public.resumen_direccion (solo totales); el dinero, de Odoo a través de la API Python
 * (solo totales agrupados). Cada bloque de Odoo carga aparte para que lo demás no espere.
 */

// ---------------------------------------------------------------- tipos (contratos de la base de datos y de la API)
type Centro = { id: number; nombre: string; plantilla: number; fichados: number; trabajando: number; ausentes: number; choferes: number;
  vacaciones_pendientes: number; ropa_pendiente: number; responsables: number };
type Zona = { id: number; nombre: string; tipo: "cliente" | "ruta"; choferes: number; trabajando: number; fichados: number; ausentes: number;
  con_camion: number; documentacion: number };
type Resumen = {
  hoy: string; plantilla: number; fichados: number; trabajando: number; en_pausa: number; ausentes: number;
  choferes: number; choferes_trabajando: number; choferes_con_camion: number; choferes_sin_zona: number; sin_centro: number; altas_mes: number;
  por_puesto: { puesto: string; n: number; pantalla: string | null }[]; centros: Centro[]; zonas: Zona[]; fichados_dias: { dia: string; n: number }[];
  ausencias: { dias_mes: number; dias_mes_anterior: number };
  pendientes: { vacaciones: number; ropa: number; ropa_entregar: number; ropa_temporada: number; por_configurar: number; odoo_error: number };
  ropa: { temporada: string; personas: number; por_entregar: number; entregadas: number; sin_tallas: number; cambios: number };
  seguridad: { caducados: number; pronto: number; faltan: number };
  incidencias: { abiertas: number; graves: number; mes: number; mes_anterior: number };
};
type Serie = { meses: { mes: string; importe: number; n: number }[]; mes: number; mes_anterior_mismo_dia: number; mes_anterior: number;
  mismo_mes_anio_anterior: number; anio: number; anio_anterior_mismo_dia: number };
type Pendiente = { total: number; n: number; vencido: number; n_vencido: number; vence_7: number; vence_30: number;
  tramos: { tramo: string; importe: number; n: number }[]; principales: { nombre: string; importe: number; vencido: number; n: number }[] };
type Base = { modo: "real" | "simulado"; actualizado: string; avisos: string[]; empresa: number | null };
type Finanzas = Base & { empresas: { id: number; nombre: string }[]; facturacion: Serie | null; ventas: Serie | null; cobros: Pendiente | null;
  pagos: Pendiente | null; sin_facturar: { importe: number; pedidos: number; antiguos: number; importe_antiguo: number } | null };
type Ventana = { mes: number; mes_anterior_mismo_dia: number; anio: number; anio_anterior_mismo_dia: number };
type CentrosOdoo = Base & { centros: { centro_id: number; nombre: string; configurado: boolean; ingresos: Ventana | null; gastos: Ventana | null;
  margen: Ventana | null }[] };
type Comercial = Base & {
  crm: { abiertas: number; valor: number; por_etapa: { etapa: string; n: number; importe: number }[]; ganadas_mes: number; ganado_mes: number;
    nuevas_mes: number; ganadas_mes_anterior?: number; ganado_mes_anterior?: number; nuevas_mes_anterior?: number } | null;
  ventas: { mes: number; pedidos_mes: number; mismo_periodo_anterior: number } | null;
};

// ---------------------------------------------------------------- formato
const euros = (n: number | undefined | null) => n === undefined || n === null ? "—"
  : n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
/** 1,2 M€ / 845 mil € para las cifras grandes de las tarjetas. */
const eurosCorto = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toLocaleString("es-ES", { maximumFractionDigits: 2 })} M€`;
  if (a >= 1e4) return `${Math.round(n / 1e3).toLocaleString("es-ES")} mil €`;
  return euros(n);
};
const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("es-ES"));
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const TRAMOS: Record<string, string> = { por_vencer: "Sin vencer", "1_30": "1–30 días", "31_60": "31–60 días", "61_90": "61–90 días", mas_90: "Más de 90 días" };

/** Variación frente a otro periodo, con flecha y palabra (nunca solo color). `menosEsMejor` para gastos, ausencias… */
function Variacion({ actual, antes, frente, menosEsMejor = false }: { actual: number; antes: number; frente: string; menosEsMejor?: boolean }) {
  if (!antes) return <span className="cm-var">{actual ? `Sin dato ${frente.replace(/^vs\. /, "del ")}` : `= ${frente.replace(/^vs\. /, "igual que el ")}`}</span>;
  const v = Math.round(((actual - antes) / Math.abs(antes)) * 100);
  const bien = v === 0 ? null : (v > 0) !== menosEsMejor;
  return <span className={`cm-var ${bien === null ? "" : bien ? "sube" : "baja"}`}>
    <span aria-hidden="true">{v > 0 ? "▲" : v < 0 ? "▼" : "="}</span> {v > 0 ? "+" : ""}{v} % {frente}
  </span>;
}

function Cifra({ titulo, valor, detalle, href, tono, barra, children }: {
  titulo: string; valor: string; detalle?: React.ReactNode; href?: string; tono?: "bien" | "atencion" | "alerta"; barra?: number; children?: React.ReactNode;
}) {
  const contenido = <>
    <span className="cm-cifra-titulo">{titulo}</span>
    <strong>{valor}</strong>
    {barra !== undefined && <span className="cm-barra" aria-hidden="true"><i style={{ width: `${Math.min(100, barra)}%` }} /></span>}
    {detalle && <span className="cm-cifra-detalle">{detalle}</span>}
    {children}
  </>;
  const clase = `cm-cifra ${tono ?? ""}`;
  return href ? <Link className={clase} href={href}>{contenido}</Link> : <div className={clase}>{contenido}</div>;
}

function Seccion({ titulo, nota, children, id }: { titulo: string; nota?: React.ReactNode; children: React.ReactNode; id: string }) {
  return <section className="cm-seccion" aria-labelledby={id}>
    <div className="cm-seccion-cabecera"><h2 id={id}>{titulo}</h2>{nota}</div>
    {children}
  </section>;
}

/** Una alerta del resumen: enlace si quien mira puede abrir esa pantalla. */
function Alerta({ href, grave, icono, texto, valor }: { href?: string; grave?: boolean; icono: string; texto: string; valor: React.ReactNode }) {
  const dentro = <><Icono nombre={icono} size={20} /><span>{texto}</span><b>{valor}</b></>;
  return href ? <Link href={href} className={`cm-alerta ${grave ? "grave" : ""}`}>{dentro}</Link>
    : <div className={`cm-alerta ${grave ? "grave" : ""}`}>{dentro}</div>;
}

const Cargando = ({ texto }: { texto: string }) => <p className="cm-cargando">{texto}</p>;
const Avisos = ({ d }: { d: Base }) => <>
  {d.modo === "simulado" && <p className="cm-aviso">Datos de ejemplo: Odoo está en modo simulado. Con la conexión real aparecen vuestras cifras.</p>}
  {d.avisos.map((a) => <p key={a} className="cm-aviso">{a}</p>)}
</>;

// Una sola llamada por petición y empresa aunque varios bloques la usen.
const leerFinanzas = cache((empresa: string) =>
  llamarPythonDetalle<Finanzas>(`/api/odoo/finanzas${empresa ? `?empresa=${empresa}` : ""}`, { espera: 25000 }));
const leerCentros = cache((empresa: string) =>
  llamarPythonDetalle<CentrosOdoo>(`/api/odoo/centros${empresa ? `?empresa=${empresa}` : ""}`, { espera: 25000 }));
const leerComercial = cache((empresa: string) =>
  llamarPythonDetalle<Comercial>(`/api/odoo/comercial${empresa ? `?empresa=${empresa}` : ""}`, { espera: 20000 }));

/** Empresa: todas, STINSA o TRANSARGI (las de ODOO_COMPANY_IDS). */
function FiltroEmpresa({ base, ver, empresa, empresas }: { base: string; ver: string; empresa: string; empresas: { id: number; nombre: string }[] }) {
  if (empresas.length < 2) return null;
  const href = (e: string) => `${base}?ver=${ver}${e ? `&empresa=${e}` : ""}`;
  return <nav className="cm-segmentos" aria-label="Empresa">
    {[{ id: "", nombre: "Todo el grupo" }, ...empresas.map((e) => ({ id: String(e.id), nombre: e.nombre }))].map((e) =>
      <Link key={e.id} href={href(e.id)} className={empresa === e.id ? "activo" : ""} aria-current={empresa === e.id ? "true" : undefined}>{e.nombre}</Link>)}
  </nav>;
}

// ---------------------------------------------------------------- gráficas (barras finas, leyenda y tabla)
/** Últimos 12 meses frente a los mismos meses del año anterior. */
function GraficaAnual({ serie, titulo }: { serie: Serie; titulo: string }) {
  const meses = serie.meses.slice(-12);
  const previos = serie.meses.slice(-24, -12);
  const max = Math.max(1, ...meses.map((m) => m.importe), ...previos.map((m) => m.importe));
  return <figure className="cm-grafica">
    <figcaption><span>{titulo}</span>
      <span className="cm-leyenda"><i className="s1" />Últimos 12 meses<i className="s2" />Mismo mes del año anterior</span></figcaption>
    <div className="cm-grafica-area" role="img" aria-label={`${titulo}: últimos 12 meses frente al año anterior. Las cifras están en la tabla de abajo.`}>
      {meses.map((m, i) => {
        const p = previos[i];
        return <div key={m.mes} className="cm-grafica-mes" tabIndex={0}>
          <div className="cm-grafica-barras">
            <i className="s1" style={{ height: `${(Math.max(0, m.importe) / max) * 100}%` }} />
            <i className="s2" style={{ height: `${(Math.max(0, p?.importe ?? 0) / max) * 100}%` }} />
          </div>
          <span className="cm-grafica-eje">{MESES[Number(m.mes.slice(5, 7)) - 1]}</span>
          <span className="cm-tip" role="tooltip"><b>{nombreMes(m.mes)}</b> {euros(m.importe)}<br />{p ? nombreMes(p.mes) : "Año anterior"}: {euros(p?.importe ?? 0)}</span>
        </div>;
      })}
    </div>
    <details className="cm-tabla-datos"><summary>Ver las cifras</summary>
      <div className="cm-tabla-caja"><table className="cm-tabla">
        <thead><tr><th>Mes</th><th>Importe</th><th>Año anterior</th><th>Variación</th></tr></thead>
        <tbody>{meses.map((m, i) => <tr key={m.mes}><td>{nombreMes(m.mes)}</td><td>{euros(m.importe)}</td><td>{euros(previos[i]?.importe ?? 0)}</td>
          <td><Variacion actual={m.importe} antes={previos[i]?.importe ?? 0} frente="" /></td></tr>)}</tbody>
      </table></div>
    </details>
  </figure>;
}

/** Barras horizontales de una sola serie (antigüedad de la deuda, embudo, puestos). */
function Barras({ filas }: { filas: { etiqueta: string; detalle?: string; valor: number; texto: string; mal?: boolean }[] }) {
  const max = Math.max(1, ...filas.map((f) => f.valor));
  return <ul className="cm-barras">
    {filas.map((f) => <li key={f.etiqueta}>
      <span className="cm-barras-etiqueta">{f.etiqueta}{f.detalle && <small>{f.detalle}</small>}</span>
      <span className="cm-barras-pista"><i style={{ width: `${(Math.max(0, f.valor) / max) * 100}%` }} /></span>
      <span className={`cm-barras-valor ${f.mal ? "cm-mal" : ""}`}>{f.texto}</span>
    </li>)}
  </ul>;
}

// ---------------------------------------------------------------- bloques de Odoo
async function AlertasFinanzas({ empresa, base }: { empresa: string; base: string }) {
  const { datos } = await leerFinanzas(empresa);
  if (!datos) return null;
  const alertas: { texto: string; valor: string; href: string; grave: boolean }[] = [];
  if (datos.cobros?.vencido) alertas.push({ texto: `Cobros vencidos · ${datos.cobros.n_vencido} facturas`, valor: eurosCorto(datos.cobros.vencido),
    href: `${base}?ver=finanzas`, grave: (datos.cobros.tramos.find((t) => t.tramo === "mas_90")?.importe ?? 0) > 0 });
  if (datos.pagos?.vencido) alertas.push({ texto: "Pagos a proveedores vencidos", valor: eurosCorto(datos.pagos.vencido), href: `${base}?ver=finanzas#pagos`, grave: true });
  if (datos.pagos?.vence_7) alertas.push({ texto: "Pagos que vencen en 7 días", valor: eurosCorto(datos.pagos.vence_7), href: `${base}?ver=finanzas#pagos`, grave: false });
  if (datos.sin_facturar?.antiguos) alertas.push({ texto: `Pedidos sin facturar desde hace +30 días · ${datos.sin_facturar.antiguos}`,
    valor: eurosCorto(datos.sin_facturar.importe_antiguo), href: `${base}?ver=finanzas#sin-facturar`, grave: false });
  return <>{alertas.map((a) => <Alerta key={a.texto} href={a.href} grave={a.grave} icono={a.grave ? "aviso" : "euro"} texto={a.texto} valor={a.valor} />)}</>;
}

async function CifrasNegocio({ empresa, base }: { empresa: string; base: string }) {
  const { datos, error } = await leerFinanzas(empresa);
  if (!datos) return <p className="cm-aviso">No se han podido leer las finanzas de Odoo: {error}</p>;
  const { facturacion: f, cobros: c, pagos: p, sin_facturar: s } = datos;
  return <div className="cm-cifras">
    <Cifra titulo="Facturado este mes" valor={f ? eurosCorto(f.mes) : "—"} href={`${base}?ver=finanzas`}>
      {f && <><Variacion actual={f.mes} antes={f.mes_anterior_mismo_dia} frente="vs. mes anterior" />
        <Variacion actual={f.mes} antes={f.mismo_mes_anio_anterior} frente="vs. hace un año" /></>}
    </Cifra>
    <Cifra titulo="Facturado en el año" valor={f ? eurosCorto(f.anio) : "—"} href={`${base}?ver=finanzas`}>
      {f && <Variacion actual={f.anio} antes={f.anio_anterior_mismo_dia} frente="vs. año anterior a la fecha" />}
    </Cifra>
    <Cifra titulo="Pendiente de cobro" valor={c ? eurosCorto(c.total) : "—"} href={`${base}?ver=finanzas`} tono={c?.vencido ? "alerta" : c ? "bien" : undefined}
      detalle={c ? <><b>{eurosCorto(c.vencido)}</b> vencido · {num(c.n_vencido)} facturas</> : undefined} />
    <Cifra titulo="Pagos pendientes" valor={p ? eurosCorto(p.total) : "—"} href={`${base}?ver=finanzas#pagos`} tono={p?.vencido ? "alerta" : p?.vence_7 ? "atencion" : undefined}
      detalle={p ? <>{eurosCorto(p.vence_7)} vencen en 7 días · {eurosCorto(p.vencido)} vencido</> : undefined} />
    <Cifra titulo="Pendiente de facturar" valor={s ? eurosCorto(s.importe) : "—"} href={`${base}?ver=finanzas#sin-facturar`} tono={s?.antiguos ? "atencion" : undefined}
      detalle={s ? `${num(s.pedidos)} pedidos · ${num(s.antiguos)} de hace más de 30 días` : undefined} />
  </div>;
}

function BloquePendiente({ titulo, id, d, quien, uno, href }: { titulo: string; id: string; d: Pendiente | null; quien: string; uno: string; href?: string }) {
  if (!d) return <div className="cm-panel" id={id}><h3>{titulo}</h3><p className="hint">Sin datos de Odoo.</p></div>;
  return <div className="cm-panel" id={id}>
    <h3>{titulo}</h3>
    <div className="cm-mini">
      <div><span>Total</span><b>{euros(d.total)}</b><small>{num(d.n)} facturas</small></div>
      <div className={d.vencido ? "mal" : ""}><span>Vencido</span><b>{euros(d.vencido)}</b><small>{num(d.n_vencido)} facturas</small></div>
      <div><span>Vence en 7 días</span><b>{euros(d.vence_7)}</b><small>En 30 días: {eurosCorto(d.vence_30)}</small></div>
    </div>
    <h4>Antigüedad</h4>
    <Barras filas={d.tramos.map((t) => ({ etiqueta: TRAMOS[t.tramo] ?? t.tramo, detalle: `${num(t.n)} facturas`, valor: t.importe,
      texto: euros(t.importe), mal: t.tramo === "mas_90" && t.importe > 0 }))} />
    {d.principales.length > 0 && <>
      <h4>{quien} con más pendiente</h4>
      <div className="cm-tabla-caja"><table className="cm-tabla">
        <thead><tr><th>{uno}</th><th>Pendiente</th><th>Vencido</th></tr></thead>
        <tbody>{d.principales.map((x) => <tr key={x.nombre}><td>{x.nombre} <small>· {x.n}</small></td><td>{euros(x.importe)}</td>
          <td className={x.vencido ? "cm-mal" : ""}>{euros(x.vencido)}</td></tr>)}</tbody>
      </table></div>
    </>}
    {href && <Link href={href} className="cm-enlace">Abrir en Odoo</Link>}
  </div>;
}

async function TabFinanzas({ empresa, base }: { empresa: string; base: string }) {
  const { datos, error } = await leerFinanzas(empresa);
  if (!datos) return <p className="cm-aviso">No se han podido leer las finanzas de Odoo: {error}</p>;
  const { facturacion: f, ventas: v, sin_facturar: s } = datos;
  return <>
    <FiltroEmpresa base={base} ver="finanzas" empresa={empresa} empresas={datos.empresas} />
    <Avisos d={datos} />
    <Suspense fallback={null}><CifrasNegocio empresa={empresa} base={base} /></Suspense>
    <div className="cm-dos">
      <div className="cm-panel">{f ? <GraficaAnual serie={f} titulo="Facturación (sin IVA)" /> : <p className="hint">Facturación no disponible.</p>}</div>
      <div className="cm-panel">{v ? <GraficaAnual serie={v} titulo="Pedidos de venta confirmados (sin IVA)" /> : <p className="hint">Ventas no disponibles.</p>}</div>
    </div>
    <div className="cm-dos">
      <BloquePendiente titulo="Cobros de clientes" id="cobros" d={datos.cobros} quien="Clientes" uno="Cliente" />
      <BloquePendiente titulo="Pagos a proveedores" id="pagos" d={datos.pagos} quien="Proveedores" uno="Proveedor" />
    </div>
    <div className="cm-panel" id="sin-facturar">
      <h3>Pendiente de facturar</h3>
      {!s ? <p className="hint">Sin datos de Odoo.</p> : <div className="cm-mini">
        <div><span>Importe</span><b>{euros(s.importe)}</b><small>{num(s.pedidos)} pedidos confirmados sin facturar</small></div>
        <div className={s.antiguos ? "mal" : ""}><span>Hace más de 30 días</span><b>{euros(s.importe_antiguo)}</b><small>{num(s.antiguos)} pedidos</small></div>
      </div>}
    </div>
    <p className="cm-pie"><Icono nombre="actualizar" size={15} /> Odoo · actualizado a las {hora(datos.actualizado)} · se refresca cada 10 minutos</p>
  </>;
}

async function TablaCentros({ r, empresa, base, conFinanzas, aAdmin }: { r: Resumen; empresa: string; base: string; conFinanzas: boolean; aAdmin?: string }) {
  const odoo = conFinanzas ? await leerCentros(empresa) : null;
  const deOdoo = new Map((odoo?.datos?.centros ?? []).map((c) => [c.centro_id, c]));
  return <>
    {conFinanzas && odoo?.datos && <><FiltroEmpresa base={base} ver="centros" empresa={empresa}
      empresas={(await leerFinanzas(empresa)).datos?.empresas ?? []} /><Avisos d={odoo.datos} /></>}
    {conFinanzas && !odoo?.datos && <p className="cm-aviso">No se han podido leer las cifras por centro: {odoo?.error}</p>}
    <div className="cm-panel"><div className="cm-tabla-caja"><table className="cm-tabla">
      <thead><tr><th>Centro</th><th>Plantilla</th><th>Presencia hoy</th><th>Ausentes</th><th>Por aprobar</th><th>Responsable</th>
        {conFinanzas && <><th>Ingresos mes</th><th>Gastos mes</th><th>Margen mes</th><th>Margen año</th></>}</tr></thead>
      <tbody>
        {r.centros.map((c) => {
          const o = deOdoo.get(c.id);
          return <tr key={c.id} className={c.plantilla || o?.configurado ? "" : "cm-vacio"}>
            <td><b>{c.nombre}</b></td><td>{c.plantilla}</td>
            <td>{c.plantilla ? <>{c.fichados} <small>({pct(c.fichados, c.plantilla - c.ausentes)} %)</small></> : "—"}</td>
            <td>{c.ausentes}</td>
            <td className={c.vacaciones_pendientes + c.ropa_pendiente ? "cm-atencion" : ""}>{c.vacaciones_pendientes + c.ropa_pendiente}</td>
            <td>{c.responsables ? <span className="etiqueta ok">{c.responsables}</span>
              : c.plantilla ? <span className="etiqueta pronto">Sin responsable</span> : <span className="cm-gris">—</span>}</td>
            {conFinanzas && (!o?.configurado ? <td colSpan={4}>{aAdmin ? <Link href={aAdmin}>Asignar su analítica de Odoo</Link> : <span className="cm-gris">Sin analítica</span>}</td> : <>
              <td>{euros(o.ingresos?.mes)}<br /><Variacion actual={o.ingresos?.mes ?? 0} antes={o.ingresos?.mes_anterior_mismo_dia ?? 0} frente="" /></td>
              <td>{euros(o.gastos?.mes)}<br /><Variacion actual={o.gastos?.mes ?? 0} antes={o.gastos?.mes_anterior_mismo_dia ?? 0} frente="" menosEsMejor /></td>
              <td className={(o.margen?.mes ?? 0) < 0 ? "cm-mal" : ""}><b>{euros(o.margen?.mes)}</b><br />
                <small>{o.ingresos?.mes ? `${pct(o.margen?.mes ?? 0, o.ingresos.mes)} % de margen` : ""}</small></td>
              <td className={(o.margen?.anio ?? 0) < 0 ? "cm-mal" : ""}>{euros(o.margen?.anio)}<br />
                <Variacion actual={o.margen?.anio ?? 0} antes={o.margen?.anio_anterior_mismo_dia ?? 0} frente="vs. año ant." /></td>
            </>)}
          </tr>;
        })}
        {r.sin_centro > 0 && <tr><td><b>Sin centro</b></td><td>{r.sin_centro}</td><td colSpan={conFinanzas ? 8 : 4}>
          {aAdmin ? <Link href="/admin?ver=personas&estado=sin_centro">Asígnales un centro</Link> : "Hay que asignarles un centro"}: sus solicitudes solo las ve la administración.</td></tr>}
      </tbody>
    </table></div></div>
    {conFinanzas && <p className="cm-pie"><Icono nombre="euro" size={15} /> Ingresos y gastos de cada centro: apuntes contables de Odoo con su cuenta o etiqueta
      analítica (la del viaje y la de la factura). Variaciones frente al mes anterior hasta el mismo día.</p>}
  </>;
}

function TablaZonas({ r, aZonas }: { r: Resumen; aZonas?: string }) {
  if (!r.zonas.length) return <div className="cm-panel"><p className="hint">Todavía no hay zonas. Una zona es un cliente o una ruta: agrupa a los chóferes que
    trabajan para él y aquí se ve cuántos están activos y si tienen la documentación al día.</p>
    {aZonas && <Link className="btn pequeno" href={aZonas}>Crear zonas y asignar chóferes</Link>}</div>;
  return <div className="cm-panel"><div className="cm-tabla-caja"><table className="cm-tabla">
    <thead><tr><th>Cliente o ruta</th><th>Chóferes</th><th>Han fichado</th><th>Trabajando</th><th>Ausentes</th><th>Con camión</th><th>Documentación</th></tr></thead>
    <tbody>
      {r.zonas.map((z) => <tr key={z.id}><td><b>{z.nombre}</b> <small>· {z.tipo === "ruta" ? "ruta" : "cliente"}</small></td>
        <td>{z.choferes}</td><td>{z.fichados} <small>({pct(z.fichados, z.choferes - z.ausentes)} %)</small></td><td>{z.trabajando}</td><td>{z.ausentes}</td>
        <td>{z.con_camion}</td><td className={z.documentacion ? "cm-mal" : ""}>{z.documentacion ? `${z.documentacion} con algo caducado` : "Al día"}</td></tr>)}
      {r.choferes_sin_zona > 0 && <tr><td><b>Sin zona</b></td><td>{r.choferes_sin_zona}</td><td colSpan={5}>
        {aZonas ? <Link href={aZonas}>Asígnales su cliente o ruta</Link> : "Hay que asignarles su cliente o ruta"}</td></tr>}
    </tbody>
  </table></div></div>;
}

async function TabComercial({ empresa, base }: { empresa: string; base: string }) {
  const [{ datos, error }, fin] = await Promise.all([leerComercial(empresa), leerFinanzas(empresa)]);
  if (!datos) return <p className="cm-aviso">No se han podido leer los datos comerciales de Odoo: {error}</p>;
  const { crm } = datos;
  return <>
    <FiltroEmpresa base={base} ver="comercial" empresa={empresa} empresas={fin.datos?.empresas ?? []} />
    <Avisos d={datos} />
    <div className="cm-cifras">
      <Cifra titulo="Oportunidades abiertas" valor={crm ? eurosCorto(crm.valor) : "—"} detalle={crm ? `${num(crm.abiertas)} en el embudo` : "CRM no disponible"} />
      <Cifra titulo="Ganado este mes" valor={crm ? eurosCorto(crm.ganado_mes) : "—"} tono={crm?.ganadas_mes ? "bien" : undefined}
        detalle={crm ? `${crm.ganadas_mes} oportunidades ganadas` : undefined}>
        {crm?.ganado_mes_anterior !== undefined && <Variacion actual={crm.ganado_mes} antes={crm.ganado_mes_anterior} frente="vs. mes anterior" />}
      </Cifra>
      <Cifra titulo="Oportunidades nuevas" valor={crm ? num(crm.nuevas_mes) : "—"} detalle="Este mes">
        {crm?.nuevas_mes_anterior !== undefined && <Variacion actual={crm.nuevas_mes} antes={crm.nuevas_mes_anterior} frente="vs. mes anterior" />}
      </Cifra>
      {fin.datos?.ventas && <Cifra titulo="Pedidos confirmados del mes" valor={eurosCorto(fin.datos.ventas.mes)}>
        <Variacion actual={fin.datos.ventas.mes} antes={fin.datos.ventas.mes_anterior_mismo_dia} frente="vs. mes anterior" />
        <Variacion actual={fin.datos.ventas.mes} antes={fin.datos.ventas.mismo_mes_anio_anterior} frente="vs. hace un año" />
      </Cifra>}
    </div>
    <div className="cm-dos">
      {crm && crm.por_etapa.length > 0 && <div className="cm-panel"><h3>Embudo de ventas</h3>
        <Barras filas={crm.por_etapa.map((e) => ({ etiqueta: e.etapa, detalle: `${e.n} ${e.n === 1 ? "oportunidad" : "oportunidades"}`, valor: e.importe, texto: euros(e.importe) }))} />
      </div>}
      {fin.datos?.ventas && <div className="cm-panel"><GraficaAnual serie={fin.datos.ventas} titulo="Pedidos de venta confirmados (sin IVA)" /></div>}
    </div>
  </>;
}

// ---------------------------------------------------------------- pestañas que solo usan la base de datos
function Presencia({ r }: { r: Resumen }) {
  const max = Math.max(1, ...r.fichados_dias.map((d) => d.n));
  const laborables = r.fichados_dias.slice(0, -1).filter((d) => d.n > 0);
  const media = laborables.length ? Math.round(laborables.reduce((s, d) => s + d.n, 0) / laborables.length) : 0;
  return <figure className="cm-grafica">
    <figcaption><span>Personas que han fichado cada día · últimas dos semanas</span><span className="cm-nota">Media de los días con actividad: {media}</span></figcaption>
    <div className="cm-grafica-area corta" role="img" aria-label={`Personas que han fichado: hoy ${r.fichados_dias.at(-1)?.n ?? 0}, media ${media}.`}>
      {r.fichados_dias.map((d) => {
        const fecha = new Date(`${d.dia}T12:00:00Z`);
        return <div key={d.dia} className="cm-grafica-mes" tabIndex={0}>
          <div className="cm-grafica-barras una"><i className="s1" style={{ height: `${(d.n / max) * 100}%` }} /></div>
          <span className="cm-grafica-eje">{fecha.toLocaleDateString("es-ES", { weekday: "narrow", timeZone: "UTC" })}{fecha.getUTCDate()}</span>
          <span className="cm-tip" role="tooltip"><b>{fecha.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</b><br />{d.n} personas</span>
        </div>;
      })}
    </div>
  </figure>;
}

// ---------------------------------------------------------------- el cuadro
export default async function CuadroDeMando({ ver, empresa = "", base = "/" }: { ver?: string; empresa?: string; base?: string }) {
  const { supabase, puede } = await usuarioActual();
  const finanzas = puede("direccion.finanzas");
  // Una cifra solo es enlace si quien mira puede abrir esa pantalla (si no, le devolvería al inicio).
  const si = (href: string, ...ps: string[]) => (puede(...ps) ? href : undefined);
  const a = {
    equipo: si("/equipo", ...permisosDe("equipo")), ropa: si("/ropa?ver=temporada", "ropa.gestionar"), cambios: si("/ropa?ver=cambios", "ropa.gestionar"),
    seguridad: si("/seguridad", "seguridad.ver", "seguridad.gestionar"), incidencias: si("/seguridad?ver=incidencias", "seguridad.ver", "seguridad.gestionar"),
    configurar: si("/admin?ver=personas&estado=configurar", "admin.usuarios"), sincronizacion: si("/admin/sincronizacion", "admin.sincronizacion"),
    zonas: si("/equipo/zonas", "zonas.gestionar"), analitica: si("/admin?ver=centros", "admin.usuarios"),
  };
  const pestanas = ([["resumen", "Resumen"], ["finanzas", "Finanzas"], ["centros", "Centros y zonas"], ["comercial", "Comercial"], ["personas", "Personas"]] as const)
    .filter(([id]) => id !== "finanzas" || finanzas);
  const vista = pestanas.find(([id]) => id === ver)?.[0] ?? "resumen";
  const empresaValida = /^\d{1,6}$/.test(empresa) ? empresa : "";
  const { data, error } = await supabase.rpc("resumen_direccion");
  const r = data as Resumen | null;
  const ahora = new Date();
  const fechaTexto = ahora.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const p = r?.pendientes;
  const porResolver = p ? p.vacaciones + p.ropa + p.ropa_entregar + p.por_configurar + p.odoo_error : 0;
  const presencia = r ? pct(r.fichados, r.plantilla - r.ausentes) : 0;
  const media = r ? (() => { const d = r.fichados_dias.slice(0, -1).filter((x) => x.n > 0); return d.length ? d.reduce((s, x) => s + x.n, 0) / d.length : 0; })() : 0;

  return <div className="cm">
    <header className="cm-cabecera">
      <div>
        <p className="inicio-antetitulo">GRUPO TRIMODOS · DIRECCIÓN</p>
        <h1>Cuadro de mando</h1>
        <p className="cm-fecha"><span>{fechaTexto}</span> · personas a las {hora(ahora.toISOString())}</p>
      </div>
    </header>
    <nav className="pestanas cm-pestanas" aria-label="Secciones del cuadro de mando">
      {pestanas.map(([id, nombre]) => <Link key={id} href={`${base}?ver=${id}${empresaValida ? `&empresa=${empresaValida}` : ""}`}
        className={vista === id ? "activa" : ""} aria-current={vista === id ? "page" : undefined}>{nombre}</Link>)}
    </nav>

    {!r ? <p className="error">No se ha podido cargar el cuadro de mando{error ? `: ${error.message}` : ""}.</p> : <>
      {vista === "resumen" && <>
        <section className="cm-alertas" aria-label="Alertas">
          {finanzas && <Suspense fallback={null}><AlertasFinanzas empresa={empresaValida} base={base} /></Suspense>}
          {r.seguridad.caducados > 0 && <Alerta href={a.seguridad} grave icono="aviso" texto="Documentación o revisiones caducadas" valor={r.seguridad.caducados} />}
          {r.incidencias.graves > 0 && <Alerta href={a.incidencias} grave icono="escudo" texto="Incidencias graves abiertas" valor={r.incidencias.graves} />}
          {p!.por_configurar > 0 && <Alerta href={a.configurar} icono="equipo" texto="Personas sin perfil (no ven nada)" valor={p!.por_configurar} />}
          {r.choferes_sin_zona > 0 && <Alerta href={a.zonas} icono="ruta" texto="Chóferes sin cliente ni ruta asignados" valor={r.choferes_sin_zona} />}
          {p!.odoo_error > 0 && <Alerta href={a.sincronizacion} icono="actualizar" texto="Fichajes o ausencias que no han llegado a Odoo" valor={p!.odoo_error} />}
        </section>

        {finanzas && <Seccion titulo="Negocio" id="cm-negocio" nota={<span className="cm-nota">Odoo · sin IVA · {empresaValida ? "empresa elegida" : "todo el grupo"}</span>}>
          <Suspense fallback={<Cargando texto="Consultando Odoo…" />}><CifrasNegocio empresa={empresaValida} base={base} /></Suspense>
        </Seccion>}

        <Seccion titulo="Personas hoy" id="cm-personas-hoy">
          <div className="cm-cifras">
            <Cifra titulo="Plantilla activa" valor={num(r.plantilla)} detalle={`${r.altas_mes} altas este mes · ${r.centros.length} centros`} href={a.configurar} />
            <Cifra titulo="Presencia" valor={`${presencia} %`} barra={presencia} href={a.equipo}
              detalle={`${num(r.fichados)} han fichado · media ${Math.round(media)} al día`} />
            <Cifra titulo="Chóferes trabajando" valor={`${num(r.choferes_trabajando)} / ${num(r.choferes)}`} barra={pct(r.choferes_trabajando, r.choferes)}
              detalle={`${r.choferes_con_camion} con camión confirmado`} href={`${base}?ver=centros#zonas`} />
            <Cifra titulo="Días de ausencia" valor={num(r.ausencias.dias_mes)} detalle={`Este mes · hoy ausentes ${r.ausentes}`}>
              <Variacion actual={r.ausencias.dias_mes} antes={r.ausencias.dias_mes_anterior} frente="vs. mes anterior" menosEsMejor />
            </Cifra>
            <Cifra titulo="Incidencias del mes" valor={num(r.incidencias.mes)} href={a.incidencias}
              tono={r.incidencias.graves ? "alerta" : r.incidencias.abiertas ? "atencion" : "bien"} detalle={`${r.incidencias.abiertas} abiertas`}>
              <Variacion actual={r.incidencias.mes} antes={r.incidencias.mes_anterior} frente="vs. mes anterior" menosEsMejor />
            </Cifra>
            <Cifra titulo="Por resolver" valor={num(porResolver)} href="/pendientes" tono={porResolver ? "atencion" : "bien"}
              detalle={porResolver ? "Vacaciones, ropa, altas y Odoo" : "Todo al día"} />
          </div>
        </Seccion>

        <div className="cm-dos">
          <Seccion titulo="Centros" id="cm-centros-resumen" nota={<Link className="cm-enlace" href={`${base}?ver=centros`}>Ver detalle</Link>}>
            <div className="cm-panel"><Barras filas={r.centros.filter((c) => c.plantilla).map((c) => ({ etiqueta: c.nombre,
              detalle: `${c.fichados} de ${c.plantilla - c.ausentes} han fichado`, valor: c.plantilla, texto: `${c.plantilla}` }))} />
              {!r.centros.some((c) => c.plantilla) && <p className="hint">Nadie tiene centro todavía.</p>}</div>
          </Seccion>
          <Seccion titulo="Chóferes por cliente o ruta" id="cm-zonas-resumen" nota={<Link className="cm-enlace" href={`${base}?ver=centros#zonas`}>Ver detalle</Link>}>
            <div className="cm-panel">{r.zonas.length ? <Barras filas={[...r.zonas.map((z) => ({ etiqueta: z.nombre,
              detalle: `${z.trabajando} trabajando ahora${z.documentacion ? ` · ${z.documentacion} con documentación caducada` : ""}`,
              valor: z.choferes, texto: `${z.choferes}`, mal: z.documentacion > 0 })),
              ...(r.choferes_sin_zona ? [{ etiqueta: "Sin zona", detalle: "Sin cliente ni ruta asignados", valor: r.choferes_sin_zona, texto: `${r.choferes_sin_zona}` }] : [])]} />
              : <><p className="hint">Todavía no hay zonas: agrupan a los chóferes por el cliente o la ruta para la que trabajan.</p>
                {a.zonas && <Link className="btn pequeno" href={a.zonas}>Crear zonas y asignar chóferes</Link>}</>}</div>
          </Seccion>
        </div>
      </>}

      {vista === "finanzas" && <Suspense fallback={<Cargando texto="Consultando las finanzas en Odoo…" />}><TabFinanzas empresa={empresaValida} base={base} /></Suspense>}

      {vista === "centros" && <>
        <Seccion titulo="Centros" id="cm-centros">
          <Suspense fallback={<Cargando texto="Consultando las cifras de cada centro en Odoo…" />}>
            <TablaCentros r={r} empresa={empresaValida} base={base} conFinanzas={finanzas} aAdmin={a.analitica} />
          </Suspense>
        </Seccion>
        <span id="zonas" />
        <Seccion titulo="Chóferes por cliente o ruta" id="cm-zonas" nota={a.zonas && <Link className="cm-enlace" href={a.zonas}>Organizar zonas</Link>}>
          <TablaZonas r={r} aZonas={a.zonas} />
        </Seccion>
      </>}

      {vista === "comercial" && <Suspense fallback={<Cargando texto="Consultando el CRM en Odoo…" />}><TabComercial empresa={empresaValida} base={base} /></Suspense>}

      {vista === "personas" && <>
        <div className="cm-panel"><Presencia r={r} /></div>
        <div className="cm-dos">
          <Seccion titulo="Por resolver" id="cm-pendientes">
            <div className="cm-panel"><ul className="cm-lista">
              {([["Vacaciones por aprobar", p!.vacaciones, a.equipo], ["Cambios de ropa por aprobar", p!.ropa, a.cambios],
                ["Cambios de ropa por entregar", p!.ropa_entregar, a.cambios], ["Personas por configurar", p!.por_configurar, a.configurar],
                ["Envíos a Odoo con error", p!.odoo_error, a.sincronizacion]] as const).map(([texto, n, href]) => {
                const fila = <><span>{texto}</span><b className={n && texto.startsWith("Envíos") ? "cm-mal" : ""}>{n}</b></>;
                return <li key={texto}>{href ? <Link href={href}>{fila}</Link> : <div className="cm-lista-fila">{fila}</div>}</li>;
              })}
            </ul></div>
          </Seccion>
          <Seccion titulo="Plantilla por perfil" id="cm-puestos">
            <div className="cm-panel">{r.por_puesto.length === 0 ? <p className="hint">Nadie tiene perfil todavía.</p>
              : <Barras filas={r.por_puesto.map((x) => ({ etiqueta: x.puesto, detalle: x.pantalla ? undefined : "Complemento", valor: x.n, texto: `${x.n}` }))} />}</div>
          </Seccion>
        </div>
        <div className="cm-dos">
          <Seccion titulo={`Ropa de ${nombreTemporada(r.ropa.temporada).toLowerCase()}`} id="cm-ropa">
            <div className="cm-cifras cm-cifras-tres">
              <Cifra titulo="Entregadas" valor={`${r.ropa.entregadas} / ${r.ropa.personas}`} barra={pct(r.ropa.entregadas, r.ropa.personas)} href={a.ropa} />
              <Cifra titulo="Sin tallas" valor={num(r.ropa.sin_tallas)} tono={r.ropa.sin_tallas ? "atencion" : "bien"} href={a.ropa}
                detalle="No se les puede preparar todavía" />
              <Cifra titulo="Cambios abiertos" valor={num(r.ropa.cambios)} href={a.cambios} detalle="Roturas, tallas o pérdidas" />
            </div>
          </Seccion>
          <Seccion titulo="Seguridad y cumplimiento" id="cm-seguridad">
            <div className="cm-cifras cm-cifras-tres">
              <Cifra titulo="Caducados" valor={num(r.seguridad.caducados)} href={a.seguridad} tono={r.seguridad.caducados ? "alerta" : "bien"}
                detalle="ITV, seguros, carnés, revisiones" />
              <Cifra titulo="Sin apuntar" valor={num(r.seguridad.faltan)} href={a.seguridad} tono={r.seguridad.faltan ? "atencion" : undefined}
                detalle="Documentación que nadie ha rellenado" />
              <Cifra titulo="Caducan en 30 días" valor={num(r.seguridad.pronto)} href={a.seguridad} />
            </div>
          </Seccion>
        </div>
      </>}
    </>}
    <p className="cm-pie"><Icono nombre="escudo" size={15} /> Solo totales: el detalle de cada persona está en su pantalla, con sus permisos.</p>
  </div>;
}
