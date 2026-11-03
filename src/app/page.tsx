import Link from "next/link";
import { Suspense } from "react";
import Cabecera from "./Cabecera";
import EstadoOdoo from "./EstadoOdoo";
import Icono, { ICONOS_AREA } from "./Icono";
import { fichar, reintentarOdoo } from "./fichaje/acciones";
import { documentosDe } from "@/lib/documentos";
import { numeroFlota, requiereAtencion, type ResumenFlota } from "@/lib/flota";
import {
  BOTON_TIPO, duracion, estadoDe, fecha, hora, hoyISO, inicioDia, inicioSemana, jornadaEnCurso, minutosPorDia, minutosTrabajados,
  NOMBRE_ESTADO, SIGUIENTES, type Fichaje,
} from "@/lib/jornada";
import { agendaDeHoy, calendarioActivo } from "@/lib/outlook";
import { AREAS } from "@/lib/permisos";
import { DOMINIO_PIN } from "@/lib/pin";
import { llamarPythonDetalle } from "@/lib/python";
import { CLASE_CADUCIDAD, DIAS_AVISO, fechaLarga, NOMBRE_CADUCIDAD, sumarDias } from "@/lib/seguridad";
import { usuarioActual } from "@/lib/usuario";

export const dynamic = "force-dynamic";

const detalles: Record<string, { titulo: string; descripcion: string; etiqueta: string }> = {
  flota: { titulo: "Centro de flota", descripcion: "Localiza cada vehículo y consulta su última actividad en Movildata.", etiqueta: "OPERACIONES" },
  chofer: { titulo: "Mi camión", descripcion: "Confirma tu vehículo y gestiona tu jornada desde la cabina.", etiqueta: "EN CARRETERA" },
  deca: { titulo: "Órdenes de transporte", descripcion: "Revisa la mercancía, actualiza la carga y descarga tu documentación.", etiqueta: "DECA" },
  fichaje: { titulo: "Fichaje", descripcion: "Registra tu entrada, tus pausas y la salida. Todo queda anotado.", etiqueta: "MI JORNADA" },
  ausencias: { titulo: "Vacaciones y ausencias", descripcion: "Solicita tus días y sigue la respuesta de tu responsable.", etiqueta: "MI TIEMPO" },
  equipo: { titulo: "Mi equipo", descripcion: "Consulta la jornada de tu equipo y atiende sus solicitudes.", etiqueta: "PERSONAS" },
  ropa: { titulo: "Ropa de trabajo", descripcion: "Pide ropa y EPIs; tu responsable la aprueba y te la entrega.", etiqueta: "EQUIPACIÓN" },
  documentos: { titulo: "Mi documentación", descripcion: "Carnés, certificados y reconocimientos al día, con aviso antes de que caduquen.", etiqueta: "MIS PAPELES" },
  incidencias: { titulo: "Incidencias", descripcion: "Avisa de un accidente, un incidente o una avería y sigue su estado.", etiqueta: "AVISAR" },
  seguridad: { titulo: "Seguridad", descripcion: "ITV, documentación, carretillas, inspecciones de almacén e incidencias.", etiqueta: "PREVENCIÓN" },
  admin: { titulo: "Administración", descripcion: "Gestiona los accesos, los centros, los vehículos y la sincronización.", etiqueta: "GESTIÓN" },
};
const orden = ["flota", "chofer", "deca", "fichaje", "ausencias", "ropa", "documentos", "incidencias", "equipo", "seguridad", "admin"];

type Indicador = { href: string; icono: string; titulo: string; valor: string; detalle: string; atencion?: boolean };

function Kpi({ href, icono, titulo, valor, detalle, atencion }: Indicador) {
  return <Link className={`inicio-kpi ${atencion ? "atencion" : ""}`} href={href}>
    <span className="inicio-kpi-titulo"><Icono nombre={icono} size={18} />{titulo}</span>
    <strong>{valor}</strong>
    <span className="hint">{detalle}</span>
  </Link>;
}

const KpiCargando = ({ titulo }: { titulo: string }) => <div className="inicio-kpi cargando" aria-busy="true">
  <span className="inicio-kpi-titulo"><Icono nombre="flota" size={18} />{titulo}</span><strong>…</strong><span className="hint">Consultando Movildata</span>
</div>;

/** La flota se pide a Movildata (a través de la API Python) sin frenar el resto del inicio. */
async function KpisFlota() {
  const { datos, error } = await llamarPythonDetalle<ResumenFlota>("/api/flota/resumen");
  if (!datos) return <Kpi href="/flota" icono="flota" titulo="Flota" valor="—" detalle={error ?? "Movildata no responde."} atencion />;
  const enRuta = datos.vehiculos.filter((v) => v.estado === "en_ruta").length;
  const atencion = datos.vehiculos.filter(requiereAtencion).length;
  const suma = (k: "km_hoy" | "consumo_hoy_litros") => {
    const valores = datos.vehiculos.map((v) => v[k]).filter((n): n is number => n !== null && Number.isFinite(n));
    return valores.length ? valores.reduce((a, b) => a + b, 0) : null;
  };
  const km = suma("km_hoy"), litros = suma("consumo_hoy_litros");
  return <>
    <Kpi href="/flota" icono="flota" titulo="En movimiento" valor={`${enRuta} de ${datos.vehiculos.length}`}
      detalle={datos.simulado ? "Vehículos de prueba" : "Vehículos de Movildata"} />
    <Kpi href="/flota" icono="ruta" titulo="Kilómetros hoy" valor={km === null ? "—" : `${numeroFlota(km)} km`}
      detalle={litros === null ? "Toda la flota" : `${numeroFlota(litros)} L de gasóleo`} />
    <Kpi href="/flota" icono="aviso" titulo="Requieren atención" valor={String(atencion)} atencion={atencion > 0}
      detalle={atencion ? "Señal antigua, poco combustible o avisos" : "Todo en orden"} />
  </>;
}

/** Agenda de hoy de su Outlook (se pide aparte: no frena el resto del inicio). */
async function AgendaHoy({ uid }: { uid: string }) {
  const citas = await agendaDeHoy(uid).catch(() => null);
  return <section className="panel inicio-agenda" aria-labelledby="agenda-titulo">
    <h2 id="agenda-titulo"><Icono nombre="calendario" size={20} />Mi agenda de hoy</h2>
    {citas === null ? <p className="hint">Para ver aquí tu calendario de Outlook, sal y vuelve a entrar con Microsoft.</p>
      : citas.length === 0 ? <p className="hint">Hoy no tienes nada en el calendario.</p>
      : <ul className="inicio-agenda-lista">{citas.map((c, i) => <li key={i}>
        <span className="inicio-agenda-hora">{c.todoElDia ? "Todo el día" : `${c.inicio.slice(11, 16)}–${c.fin.slice(11, 16)}`}</span>
        <span><b>{c.asunto}</b>{c.lugar && <span className="hint"> · {c.lugar}</span>}</span>
      </li>)}</ul>}
  </section>;
}

/** Número de una consulta con `count`; null si no se ha podido leer. */
const cuenta = (r: { count: number | null; error: unknown } | null) => (!r || r.error ? null : r.count ?? 0);
const cifra = (n: number | null) => (n === null ? "—" : String(n));

export default async function Inicio({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { perfil, veArea, puede, esDeSuPuesto, supabase, uid } = await usuarioActual();
  const { ok, error } = await searchParams;
  const nombre = perfil?.nombre || perfil?.email || perfil?.codigo || "";
  const mias = AREAS.filter((a) => veArea(a.id)).sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id));
  const puedeJornada = puede("fichaje.fichar", "chofer.usar");
  const semana = inicioSemana();
  const ayer = inicioDia(1);
  const hoy = hoyISO();
  // Cada indicador se pide solo si se tiene su permiso; la base de datos (RLS) decide además qué filas ve cada uno.
  const veSeguridad = puede("seguridad.ver", "seguridad.gestionar");
  const enAviso = sumarDias(hoy, DIAS_AVISO);
  const [registro, solicitudes, proxima, camion, equipo, porAprobar, porActivar, fichajesMal, ausenciasMal, misDocs, caducan, incidencias,
    ropaPendiente, ropaAprobada] = await Promise.all([
    puedeJornada ? supabase.from("fichajes").select("tipo,momento,odoo_estado,odoo_error").eq("usuario_id", uid)
      .gte("momento", new Date(Math.min(semana.getTime(), ayer.getTime())).toISOString()).order("momento") : null,
    puede("ausencias.pedir") ? supabase.from("ausencias").select("id", { count: "exact", head: true })
      .eq("usuario_id", uid).eq("estado", "pendiente") : null,
    puede("ausencias.pedir") ? supabase.from("ausencias").select("desde,hasta").eq("usuario_id", uid).eq("estado", "aprobada")
      .gte("hasta", hoy).order("desde").limit(1).maybeSingle<{ desde: string; hasta: string }>() : null,
    puede("chofer.usar") ? supabase.from("asignaciones").select("vehiculos(matricula)").eq("usuario_id", uid).is("fin", null)
      .maybeSingle<{ vehiculos: { matricula: string } | null }>() : null,
    puede("equipo.ver") ? supabase.from("fichajes").select("usuario_id,tipo").gte("momento", ayer.toISOString())
      .order("momento", { ascending: false }).limit(1000) : null,
    puede("ausencias.aprobar") ? supabase.from("ausencias").select("id", { count: "exact", head: true })
      .eq("estado", "pendiente").neq("usuario_id", uid) : null,
    puede("admin.usuarios") ? supabase.from("usuarios").select("id", { count: "exact", head: true }).eq("activo", false) : null,
    puede("admin.sincronizacion") ? supabase.from("fichajes").select("id", { count: "exact", head: true })
      .in("odoo_estado", ["error", "sin_empleado"]) : null,
    puede("admin.sincronizacion") ? supabase.from("ausencias").select("id", { count: "exact", head: true })
      .in("odoo_estado", ["error", "sin_empleado"]) : null,
    esDeSuPuesto("documentos.propios") ? documentosDe(supabase, uid) : null,
    // Caducidades: todas para seguridad; las de los camiones para quien los gestiona.
    veSeguridad ? supabase.from("documentos").select("id", { count: "exact", head: true }).lte("caduca", enAviso)
      : puede("vehiculos.gestionar") ? supabase.from("documentos").select("id", { count: "exact", head: true }).lte("caduca", enAviso)
        .not("vehiculo_id", "is", null) : null,
    veSeguridad ? supabase.from("incidencias").select("id", { count: "exact", head: true }).neq("estado", "cerrada") : null,
    // Ropa del equipo: la base de datos solo cuenta la de las personas de sus centros.
    puede("ropa.gestionar") ? supabase.from("solicitudes_ropa").select("id", { count: "exact", head: true })
      .eq("estado", "pendiente").neq("usuario_id", uid) : null,
    puede("ropa.gestionar") ? supabase.from("solicitudes_ropa").select("id", { count: "exact", head: true })
      .eq("estado", "aprobada").neq("usuario_id", uid) : null,
  ]);

  // Mi jornada: estado con las últimas 24 h (turnos de noche), horas de hoy y de la semana, y si ha llegado a Odoo.
  const fichajes = (registro?.data ?? []) as Fichaje[];
  const ultimas24 = fichajes.filter((f) => new Date(f.momento).getTime() >= ayer.getTime());
  const estado = estadoDe(ultimas24);
  const deHoy = fichajes.filter((f) => new Date(f.momento).getTime() >= inicioDia().getTime());
  const minutosHoy = minutosTrabajados(estado === "fuera" ? deHoy : jornadaEnCurso(ultimas24));
  const minutosSemana = minutosPorDia(fichajes.filter((f) => new Date(f.momento).getTime() >= semana.getTime()));
  const ultimo = fichajes.at(-1);
  const sinEnviar = fichajes.some((f) => ["pendiente", "error", "sin_empleado"].includes(f.odoo_estado));

  // Indicadores: cada uno depende de un permiso, nunca de un perfil concreto.
  const indicadores: (Indicador | "flota")[] = [];
  if (esDeSuPuesto("chofer.usar")) {
    const matricula = camion?.data?.vehiculos?.matricula;
    indicadores.push({ href: "/chofer", icono: "camion", titulo: "Mi camión", valor: matricula ?? "Sin confirmar",
      detalle: matricula ? "Confirmado para tu jornada" : "Confírmalo al subir a la cabina" });
  }
  if (puede("flota.ver")) indicadores.push("flota");
  if (puede("equipo.ver")) {
    const ultimos = new Map<string, Fichaje["tipo"]>();   // vienen del más reciente al más antiguo
    for (const f of (equipo?.data ?? []) as { usuario_id: string; tipo: Fichaje["tipo"] }[]) if (!ultimos.has(f.usuario_id)) ultimos.set(f.usuario_id, f.tipo);
    const tipos = [...ultimos.values()];
    const enPausa = tipos.filter((t) => t === "pausa").length;
    indicadores.push({ href: "/equipo", icono: "equipo", titulo: "Trabajando ahora",
      valor: equipo?.error ? "—" : String(tipos.filter((t) => t === "entrada" || t === "reanudar").length),
      detalle: enPausa ? `Y ${enPausa} en pausa` : "Nadie en pausa" });
  }
  if (puede("ausencias.aprobar")) {
    const n = cuenta(porAprobar);
    indicadores.push({ href: "/equipo", icono: "calendario", titulo: "Ausencias por aprobar", valor: cifra(n),
      detalle: "De las personas de tus centros", atencion: !!n });
  }
  if (ropaPendiente) {
    const n = cuenta(ropaPendiente), m = cuenta(ropaAprobada);
    indicadores.push({ href: "/ropa", icono: "ropa", titulo: "Ropa por aprobar", valor: cifra(n), atencion: !!n,
      detalle: m ? `Y ${m} ${m === 1 ? "pedido aprobado" : "pedidos aprobados"} por entregar` : "De las personas de tus centros" });
  }
  if (puede("admin.usuarios")) {
    const n = cuenta(porActivar);
    indicadores.push({ href: "/admin", icono: "escudo", titulo: "Usuarios sin activar", valor: cifra(n),
      detalle: n ? "Actívalos en Administración" : "Nadie esperando acceso", atencion: !!n });
  }
  if (puede("admin.sincronizacion")) {
    const f = cuenta(fichajesMal), a = cuenta(ausenciasMal);
    const n = f === null || a === null ? null : f + a;
    indicadores.push({ href: "/admin/sincronizacion", icono: "actualizar", titulo: "Envíos a Odoo con error", valor: cifra(n),
      detalle: n ? "Fichajes o ausencias sin llegar a Odoo" : "Todo enviado", atencion: !!n });
  }
  if (caducan) {
    const n = cuenta(caducan);
    indicadores.push({ href: veSeguridad ? "/seguridad" : "/seguridad?ver=vehiculos", icono: "documento",
      titulo: veSeguridad ? "Caducidades" : "ITV y seguros", valor: cifra(n), atencion: !!n,
      detalle: n ? `Vencidas o en los próximos ${DIAS_AVISO} días` : `Nada caduca en ${DIAS_AVISO} días` });
  }
  if (incidencias) {
    const n = cuenta(incidencias);
    indicadores.push({ href: "/seguridad?ver=incidencias", icono: "escudo", titulo: "Incidencias abiertas", valor: cifra(n),
      detalle: n ? "Pendientes de cerrar" : "Ninguna abierta", atencion: !!n });
  }
  if (puede("ausencias.pedir")) {
    const n = cuenta(solicitudes);
    indicadores.push({ href: "/ausencias", icono: "calendario", titulo: "Mis solicitudes", valor: cifra(n),
      detalle: n === 1 ? "Pendiente de respuesta" : "Pendientes de respuesta" });
    const p = proxima?.data;
    indicadores.push({ href: "/ausencias", icono: "calendario", titulo: "Próxima ausencia",
      valor: !p ? "Ninguna" : p.desde <= hoy ? "Ahora" : fecha(p.desde),
      detalle: !p ? "No tienes días aprobados" : p.desde === p.hasta ? "Aprobada" : `Aprobada, hasta el ${fecha(p.hasta)}` });
  }

  const docsPendientes = misDocs?.situacion.filter((s) => s.estado !== "al_dia") ?? [];
  const conAgenda = calendarioActivo() && !!perfil?.email && !perfil.email.endsWith(`@${DOMINIO_PIN}`);

  const ahora = new Date();
  const h = Number(ahora.toLocaleString("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }));
  const saludo = h < 13 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches";
  const hoyTexto = ahora.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" });

  return <>
    <Cabecera nombre={nombre} admin={veArea("admin")} />
    <main className="contenido inicio-contenido">
      <div className="inicio-bienvenida">
        <div><p className="inicio-antetitulo">GRUPO TRIMODOS · CENTRO DE TRABAJO</p>
          <h1>{saludo}{nombre ? `, ${nombre.split(/[ @]/)[0]}` : ""}.</h1>
          <p className="lead">Tu jornada y lo importante de hoy, de un vistazo.</p>
        </div>
        <div className="inicio-fecha"><Icono nombre="calendario" size={19} /><span>{hoyTexto}</span></div>
      </div>
      {ok && <p className="aviso" role="status">{ok}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {!perfil || !perfil.activo ? <section className="panel inicio-sin-acceso"><Icono nombre="escudo" size={36} />
        <h2>Estamos preparando tu acceso</h2><p>Tu usuario está pendiente de activar. Avisa a la oficina para empezar a usar tus herramientas.</p>
      </section> : mias.length === 0 ? <section className="panel inicio-sin-acceso"><Icono nombre="equipo" size={36} />
        <h2>Tu espacio está listo</h2><p>Pide a la oficina que te asigne un perfil para ver las herramientas de tu puesto.</p>
      </section> : <>
        {docsPendientes.length > 0 && <section className="panel inicio-avisos" aria-labelledby="avisos-titulo">
          <h2 id="avisos-titulo"><Icono nombre="aviso" size={20} />Tienes documentación por poner al día</h2>
          <ul>{docsPendientes.map((s) => <li key={s.tipo}>{s.nombre}{" "}
            <span className={`etiqueta ${CLASE_CADUCIDAD[s.estado]}`}>{NOMBRE_CADUCIDAD[s.estado]}{s.doc?.caduca ? ` · ${fechaLarga(s.doc.caduca)}` : ""}</span>
          </li>)}</ul>
          <Link className="btn primario" href="/documentos">Completar mi documentación<Icono nombre="flecha" size={18} /></Link>
        </section>}

        {puedeJornada && <section className="inicio-jornada" aria-labelledby="jornada-titulo">
          <div>
            <h2 id="jornada-titulo" className="inicio-jornada-titulo"><Icono nombre="reloj" size={18} />Mi jornada</h2>
            <span className={`inicio-estado ${registro?.error ? "" : estado}`}><i />{registro?.error ? "Sin datos de jornada" : NOMBRE_ESTADO[estado]}</span>
            <p className="inicio-jornada-tiempo">{registro?.error ? "—" : duracion(minutosHoy)}</p>
            <p className="inicio-jornada-sub">{estado === "fuera" ? "Trabajado hoy" : "Llevas en esta jornada"}</p>
            <div className="inicio-jornada-datos">
              <span>Esta semana <b>{duracion(minutosSemana)}</b></span>
              {ultimo && <span>Último fichaje <b>{hora(ultimo.momento)}</b> <EstadoOdoo estado={ultimo.odoo_estado} error={ultimo.odoo_error} /></span>}
            </div>
          </div>
          <div className="inicio-jornada-botones">
            {puede("fichaje.fichar") ? SIGUIENTES[estado].map((t, i) => <form key={t} action={fichar}>
              <input type="hidden" name="tipo" value={t} />
              <input type="hidden" name="volver" value="/" />
              <button className={`btn ancho grande ${i === 0 ? "primario" : ""}`}>{BOTON_TIPO[t]}</button>
            </form>) : <Link className="btn ancho grande primario" href="/chofer">Ir a mi camión</Link>}
            {sinEnviar && <form action={reintentarOdoo}>
              <input type="hidden" name="volver" value="/" />
              <button className="btn ancho pequeno">Reintentar envío a Odoo</button>
            </form>}
            <Link className="inicio-jornada-enlace" href={puede("fichaje.fichar") ? "/fichaje" : "/chofer"}>Ver mis fichajes<Icono nombre="flecha" size={16} /></Link>
          </div>
        </section>}

        {conAgenda && <Suspense fallback={<section className="panel inicio-agenda"><h2><Icono nombre="calendario" size={20} />Mi agenda de hoy</h2>
          <p className="hint">Consultando Outlook…</p></section>}><AgendaHoy uid={uid} /></Suspense>}

        {indicadores.length > 0 && <>
          <div className="inicio-seccion-heading"><div><h2>Tus indicadores</h2><p>Lo importante de hoy, según tu puesto.</p></div></div>
          <div className="inicio-kpis">
            {indicadores.map((k) => k === "flota"
              ? <Suspense key="flota" fallback={<><KpiCargando titulo="En movimiento" /><KpiCargando titulo="Kilómetros hoy" /><KpiCargando titulo="Requieren atención" /></>}><KpisFlota /></Suspense>
              : <Kpi key={k.titulo} {...k} />)}
          </div>
        </>}

        <div className="inicio-seccion-heading"><div><h2>Tus herramientas</h2><p>Accesos para el trabajo de cada día.</p></div><span>{mias.length} disponibles</span></div>
        <nav className="inicio-modulos" aria-label="Herramientas disponibles">
          {mias.map((a) => <a key={a.id} className={`inicio-modulo ${a.id === "flota" ? "inicio-modulo-flota" : ""}`} href={a.ruta}>
            <div className="inicio-modulo-top"><span className="inicio-icono"><Icono nombre={ICONOS_AREA[a.id] ?? "documento"} size={25} /></span><span>{detalles[a.id]?.etiqueta ?? "HERRAMIENTA"}</span><Icono nombre="flecha" size={19} /></div>
            <h3>{detalles[a.id]?.titulo ?? a.nombre}</h3><p>{detalles[a.id]?.descripcion ?? a.descripcion}</p>
          </a>)}
        </nav>
        <footer className="inicio-pie"><span className="shell-brand-line" /><span>Grupo Trimodos</span><span>Conectamos personas, movemos soluciones.</span></footer>
      </>}
    </main>
  </>;
}
