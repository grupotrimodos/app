"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icono from "../Icono";
import { hoyISO } from "@/lib/jornada";
import {
  fechaFlota, numeroFlota, NOMBRE_ESTADO_FLOTA, requiereAtencion, tienePosicion,
  type RecorridoFlota, type ResumenFlota, type VehiculoFlota,
} from "@/lib/flota";
import MapaFlota from "./MapaFlota";

class ErrorSesion extends Error {}
async function consultar<T>(ruta: string, signal: AbortSignal): Promise<T> {
  const sesion = await fetch("/api/sesion/token", { cache: "no-store", signal });
  if (sesion.status === 401 || sesion.status === 403) throw new ErrorSesion("Tu sesión ha caducado. Vuelve a entrar en la app.");
  if (!sesion.ok) throw new Error("No se ha podido comprobar tu sesión. Inténtalo de nuevo.");
  const { token } = await sesion.json();
  if (!token) throw new ErrorSesion("Vuelve a iniciar sesión para consultar la flota.");
  const r = await fetch(ruta, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
  if (r.status === 401 || r.status === 403) throw new ErrorSesion("No tienes acceso a estos datos. Comprueba tu sesión y tus permisos.");
  if (!r.ok) {
    const respuesta = await r.json().catch(() => null);
    throw new Error(typeof respuesta?.error === "string" ? respuesta.error : "No se ha podido consultar Movildata. Inténtalo de nuevo en un momento.");
  }
  return r.json() as Promise<T>;
}

function EtiquetaEstado({ vehiculo }: { vehiculo: VehiculoFlota }) {
  return <span className={`flota-estado ${vehiculo.estado}`}><i />{NOMBRE_ESTADO_FLOTA[vehiculo.estado]}</span>;
}

function Combustible({ valor }: { valor: number | null }) {
  return <div className={`flota-combustible ${valor !== null && valor < 20 ? "bajo" : ""}`}>
    <div className="flota-combustible-barra" role={valor === null ? undefined : "meter"}
      aria-label="Nivel de combustible" aria-valuemin={0} aria-valuemax={100} aria-valuenow={valor ?? undefined}>
      <span style={{ width: `${valor === null ? 0 : Math.max(0, Math.min(100, valor))}%` }} />
    </div><span>{valor === null ? "Sin dato" : `${numeroFlota(valor)} %`}</span>
  </div>;
}

function descargar(vehiculos: VehiculoFlota[]) {
  const celda = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
  };
  const filas: unknown[][] = [["Matrícula", "Estado", "Última posición", "Velocidad (km/h)", "Combustible (%)", "Km hoy", "Consumo hoy (l)", "Latitud", "Longitud"]];
  vehiculos.forEach((v) => filas.push([v.matricula, NOMBRE_ESTADO_FLOTA[v.estado], v.fecha_posicion, v.velocidad_kmh,
    v.combustible_pct, v.km_hoy, v.consumo_hoy_litros, v.latitud, v.longitud]));
  const url = URL.createObjectURL(new Blob(["\ufeff" + filas.map((f) => f.map(celda).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const enlace = document.createElement("a");
  enlace.href = url; enlace.download = `flota-trimodos-${hoyISO()}.csv`; enlace.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ETIQUETA_CONEXION: Record<ResumenFlota["estado"], string> = {
  conectado: "Movildata conectado", parcial: "Información parcial", error: "Sin conexión",
  sin_configurar: "Conexión pendiente", simulado: "Modo de prueba",
};
type Filtro = "todos" | "en_ruta" | "detenido" | "atencion";
const FILTROS: { id: Filtro; nombre: string }[] = [
  { id: "todos", nombre: "Todos" }, { id: "en_ruta", nombre: "En movimiento" },
  { id: "detenido", nombre: "Detenidos" }, { id: "atencion", nombre: "A revisar" },
];

export default function CentroFlota({ inicial, errorInicial }: { inicial: ResumenFlota | null; errorInicial: string | null }) {
  const [datos, setDatos] = useState(inicial);
  const [error, setError] = useState(errorInicial);
  const [sesionCaducada, setSesionCaducada] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [automatico, setAutomatico] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [seleccionado, setSeleccionado] = useState<string | null>(inicial?.vehiculos[0]?.id ?? null);
  const [fecha, setFecha] = useState(hoyISO);
  const [recorrido, setRecorrido] = useState<RecorridoFlota | null>(null);
  const [errorRuta, setErrorRuta] = useState<string | null>(null);
  const [cargandoRuta, setCargandoRuta] = useState(false);
  const peticion = useRef<AbortController | null>(null);
  const peticionRuta = useRef<AbortController | null>(null);
  const [ahora, setAhora] = useState(() => Date.parse(inicial?.actualizado_en ?? "") || 0);

  const actualizar = useCallback(async () => {
    if (peticion.current) return;
    const controller = new AbortController();
    peticion.current = controller;
    const limite = setTimeout(() => controller.abort("tiempo"), 30000);
    setCargando(true);
    try {
      const r = await consultar<ResumenFlota>("/api/flota/resumen", controller.signal);
      if (controller.signal.aborted) return;
      setDatos(r); setError(null); setSesionCaducada(false); setAhora(Date.now());
      setSeleccionado((id) => r.vehiculos.some((v) => v.id === id) ? id : r.vehiculos[0]?.id ?? null);
    } catch (e) {
      if (!controller.signal.aborted || controller.signal.reason === "tiempo") {
        setError(e instanceof Error && !controller.signal.aborted ? e.message : "Movildata está tardando en responder. Vuelve a actualizar.");
        if (e instanceof ErrorSesion) { setDatos(null); setRecorrido(null); setSesionCaducada(true); setAutomatico(false); }
      }
    } finally {
      clearTimeout(limite);
      if (peticion.current === controller) { peticion.current = null; setCargando(false); }
    }
  }, []);

  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 30000);
    const tick = () => { if (automatico && document.visibilityState === "visible") void actualizar(); };
    const intervalo = setInterval(tick, 60000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(reloj); clearInterval(intervalo); document.removeEventListener("visibilitychange", tick); };
  }, [automatico, actualizar]);
  useEffect(() => () => { peticion.current?.abort(); peticionRuta.current?.abort(); }, []);
  useEffect(() => {
    peticionRuta.current?.abort(); peticionRuta.current = null;
    setRecorrido(null); setErrorRuta(null); setCargandoRuta(false);
  }, [seleccionado, fecha]);

  const vehiculos = datos?.vehiculos ?? [];
  const visibles = useMemo(() => vehiculos.filter((v) => {
    const texto = `${v.matricula} ${v.modelo ?? ""} ${v.tipo ?? ""}`.toLocaleLowerCase("es").replace(/\s/g, "");
    const coincide = texto.includes(busqueda.toLocaleLowerCase("es").replace(/\s/g, ""));
    return coincide && (filtro === "todos" || (filtro === "atencion" ? requiereAtencion(v) : v.estado === filtro));
  }), [vehiculos, filtro, busqueda]);
  const elegido = visibles.find((v) => v.id === seleccionado) ?? null;
  useEffect(() => {
    if (!visibles.some((v) => v.id === seleccionado)) setSeleccionado(visibles[0]?.id ?? null);
  }, [visibles, seleccionado]);
  const conKm = vehiculos.filter((v) => v.km_hoy !== null);
  const km = conKm.reduce((s, v) => s + (v.km_hoy ?? 0), 0);
  const atencion = vehiculos.filter(requiereAtencion).length;
  const enRuta = vehiculos.filter((v) => v.estado === "en_ruta").length;
  const sinPosicion = visibles.filter((v) => !tienePosicion(v)).length;
  const fechaMin = new Date(`${hoyISO()}T12:00:00Z`); fechaMin.setUTCDate(fechaMin.getUTCDate() - 30);
  const edadConsulta = datos && ahora ? Math.max(0, Math.floor((ahora - Date.parse(datos.actualizado_en)) / 60000)) : 0;
  const atrasado = edadConsulta > 3;
  const inventarioDisponible = datos?.estado === "conectado" || datos?.estado === "parcial";

  async function cargarRecorrido() {
    if (!elegido) return;
    peticionRuta.current?.abort();
    const controller = new AbortController(); peticionRuta.current = controller;
    const limite = setTimeout(() => controller.abort("tiempo"), 30000);
    setCargandoRuta(true); setErrorRuta(null); setRecorrido(null);
    try {
      const r = await consultar<RecorridoFlota>(`/api/flota/vehiculos/${encodeURIComponent(elegido.id)}/recorrido?fecha=${encodeURIComponent(fecha)}`, controller.signal);
      if (!controller.signal.aborted && peticionRuta.current === controller) setRecorrido(r);
    } catch (e) {
      if (!controller.signal.aborted || controller.signal.reason === "tiempo") setErrorRuta(e instanceof Error && !controller.signal.aborted ? e.message : "La consulta ha tardado demasiado. Inténtalo de nuevo.");
      if (e instanceof ErrorSesion) { setDatos(null); setSesionCaducada(true); setAutomatico(false); }
    } finally {
      clearTimeout(limite);
      if (peticionRuta.current === controller) { peticionRuta.current = null; setCargandoRuta(false); }
    }
  }

  return <>
    <div className="flota-encabezado">
      <div><p className="flota-antetitulo">OPERACIONES / FLOTA</p><h1>El pulso de tu flota<span>.</span></h1>
        <p className="lead">Cada vehículo, su actividad y lo que necesita tu atención.</p></div>
      <div className="flota-acciones">
        <button type="button" className="btn" onClick={() => descargar(visibles)} disabled={!visibles.length}>Exportar lista</button>
        <button type="button" className="btn primario" onClick={actualizar} disabled={cargando || sesionCaducada}>
          <Icono nombre="actualizar" size={18} className={cargando ? "flota-girando" : ""} />{cargando ? "Actualizando…" : "Actualizar"}</button>
      </div>
    </div>

    <div className="flota-conexion">
      <span className={`flota-proveedor ${datos?.estado === "conectado" && !error && !atrasado ? "conectado" : "pendiente"}`}>
        <i />{error ? "Consulta interrumpida" : datos ? ETIQUETA_CONEXION[datos.estado] : "Esperando conexión"}</span>
      {datos && <span>Consultado {fechaFlota(datos.actualizado_en)}{atrasado ? ` · hace ${edadConsulta} min` : ""}</span>}
      <label className="flota-actualizacion"><input type="checkbox" checked={automatico} disabled={sesionCaducada} onChange={(e) => setAutomatico(e.target.checked)} />Actualizar cada minuto</label>
    </div>
    {error && <div className="error" role="alert">{error}{datos && " Se conserva la última información recibida."}
      {sesionCaducada && <> <a href="/login?next=/flota">Volver a entrar</a></>}</div>}
    {atrasado && !error && <p className="aviso">Esta consulta tiene más de tres minutos. Actualiza para comprobar si hay novedades.</p>}
    {datos?.avisos.length ? <div className="flota-avisos" role="status">{datos.avisos.map((a, i) => <p key={i}>{a}</p>)}</div> : null}

    <section className="flota-indicadores" aria-label="Resumen de la flota">
      <div className="flota-indicador"><span className="flota-indicador-icono"><Icono nombre="flota" /></span><p>Vehículos disponibles</p>
        <strong>{inventarioDisponible ? vehiculos.length : "—"}</strong><small>En la cuenta de Movildata</small></div>
      <div className="flota-indicador"><span className="flota-indicador-icono verde"><Icono nombre="actividad" /></span><p>En movimiento</p>
        <strong>{inventarioDisponible ? enRuta : "—"}{inventarioDisponible && <span> / {vehiculos.length}</span>}</strong><small>Según su última señal reciente</small></div>
      <div className="flota-indicador"><span className="flota-indicador-icono"><Icono nombre="ubicacion" /></span><p>Kilómetros de hoy</p>
        <strong>{conKm.length ? numeroFlota(km) : "—"}<span> km</span></strong><small>Datos de {conKm.length} de {vehiculos.length} vehículos</small></div>
      <button type="button" className={`flota-indicador flota-indicador-boton ${atencion ? "atencion" : ""}`} onClick={() => setFiltro("atencion")}>
        <span className="flota-indicador-icono"><Icono nombre="reloj" /></span><p>A revisar</p><strong>{inventarioDisponible ? atencion : "—"}</strong>
        <small>Señal, combustible o datos pendientes <span aria-hidden="true">↗</span></small></button>
    </section>

    {!vehiculos.length ? <section className="flota-vacio-grande">
      <span className="flota-vacio-icono"><Icono nombre="flota" size={34} /></span>
      <p className="flota-antetitulo">CENTRO DE FLOTA</p><h2>{datos?.estado === "simulado" ? "Listo para conectar tu flota" : "Todavía no hay vehículos disponibles"}</h2>
      <p>{datos?.estado === "simulado" ? "Estás en modo de prueba. Al activar la conexión real aparecerán las matrículas y los datos disponibles de tu cuenta." :
        "Cuando Movildata facilite los vehículos, podrás ver sus posiciones, consultar recorridos y detectar qué necesita revisión."}</p>
      <div className="flota-vacio-funciones"><span><Icono nombre="ubicacion" />Ubicación</span><span><Icono nombre="combustible" />Combustible</span><span><Icono nombre="actividad" />Recorridos</span></div>
      <button type="button" className="btn primario" onClick={actualizar} disabled={cargando || sesionCaducada}>Comprobar conexión</button>
    </section> : <>
      <div className="flota-herramientas">
        <div className="flota-filtros" aria-label="Filtrar vehículos">{FILTROS.map((f) => <button type="button" key={f.id}
          aria-pressed={filtro === f.id} className={filtro === f.id ? "activo" : ""} onClick={() => setFiltro(f.id)}>{f.nombre}
          {f.id === "todos" && <span>{vehiculos.length}</span>}{f.id === "atencion" && atencion > 0 && <span>{atencion}</span>}</button>)}</div>
        <div className="flota-buscador"><Icono nombre="buscar" size={18} /><label htmlFor="buscar-flota" className="flota-solo-lector">Buscar matrícula o modelo</label>
          <input id="buscar-flota" type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar matrícula o modelo" /></div>
      </div>

      <div className="flota-operaciones">
        <section className="flota-listado" aria-label="Vehículos">
          <div className="flota-seccion-titulo"><h2>Tu flota</h2><span>{visibles.length} vehículos</span></div>
          <div className="flota-tarjetas">
            {visibles.map((v) => <button type="button" key={v.id} onClick={() => setSeleccionado(v.id)} aria-pressed={seleccionado === v.id}
              className={`flota-vehiculo ${seleccionado === v.id ? "seleccionado" : ""}`}>
              <div className="flota-vehiculo-arriba"><span className="flota-camion-icono"><Icono nombre="camion" size={25} /></span>
                <span className="flota-vehiculo-identidad"><strong>{v.matricula}</strong><small>{v.modelo || v.tipo || "Vehículo de la flota"}</small></span>
                <span className="flota-vehiculo-flecha" aria-hidden="true">↗</span></div>
              <EtiquetaEstado vehiculo={v} />
              <div className="flota-vehiculo-datos"><span><b>{numeroFlota(v.km_hoy)}</b> km hoy</span><Combustible valor={v.combustible_pct} /></div>
              <p className="flota-ultima-senal"><Icono nombre="reloj" size={13} />{v.fecha_posicion ? `Señal ${fechaFlota(v.fecha_posicion)}` : "Sin posición recibida"}</p>
            </button>)}
            {!visibles.length && <div className="flota-sin-resultados"><Icono nombre="buscar" size={28} /><h3>No hay coincidencias</h3>
              <p>Prueba con otra matrícula o cambia el filtro.</p><button type="button" className="btn" onClick={() => { setBusqueda(""); setFiltro("todos"); }}>Ver todos</button></div>}
          </div>
        </section>

        <section className="flota-vista" aria-label="Mapa y detalle del vehículo">
          <MapaFlota vehiculos={visibles} seleccionado={seleccionado} puntos={recorrido?.puntos ?? []} seleccionar={setSeleccionado} />
          <div className="flota-leyenda"><span><i className="movimiento" />En movimiento</span><span><i className="detenido" />Detenido</span>
            <span><i className="antigua" />Señal antigua</span>{sinPosicion > 0 && <span>{sinPosicion} sin posición</span>}</div>
          {elegido && <div className="flota-detalle">
            <div className="flota-detalle-cabecera"><div><p className="flota-antetitulo">VEHÍCULO SELECCIONADO</p><h2>{elegido.matricula}</h2>
              <p>{elegido.modelo || elegido.tipo || "Vehículo de la flota"}</p></div><EtiquetaEstado vehiculo={elegido} /></div>
            {elegido.avisos.map((a, i) => <p className="aviso" key={i}>{a}</p>)}
            <div className="flota-detalle-datos">
              <div><span>Última velocidad</span><strong>{numeroFlota(elegido.velocidad_kmh)} <small>km/h</small></strong>
                <small>{elegido.motor_encendido === null ? "Motor: sin dato" : elegido.motor_encendido ? "Motor encendido" : "Motor apagado"}</small></div>
              <div><span>Combustible</span><strong>{numeroFlota(elegido.combustible_pct)} <small>%</small></strong>
                <small>{elegido.combustible_litros === null ? "Litros no disponibles" : `${numeroFlota(elegido.combustible_litros)} litros`}</small></div>
              <div><span>Recorrido hoy</span><strong>{numeroFlota(elegido.km_hoy, 1)} <small>km</small></strong>
                <small>{elegido.consumo_hoy_litros === null ? "Consumo no disponible" : `${numeroFlota(elegido.consumo_hoy_litros, 1)} l consumidos`}</small></div>
              <div><span>Consumo medio hoy</span><strong>{numeroFlota(elegido.consumo_medio_l_100km, 1)}</strong><small>litros / 100 km</small></div>
            </div>
            <div className="flota-datos-fechas"><span>Posición: {fechaFlota(elegido.fecha_posicion)}</span><span>Combustible: {fechaFlota(elegido.fecha_combustible)}</span>
              <span>Actividad de hoy hasta: {fechaFlota(elegido.datos_hoy_hasta)}</span></div>
            {elegido.combustible_pct !== null && elegido.combustible_pct < 20 && <p className="aviso">Combustible por debajo del 20 %. Comprueba la fecha del dato antes de planificar el repostaje.</p>}
            {tienePosicion(elegido) && <a className="flota-ubicacion" href={`https://www.google.com/maps/search/?api=1&query=${elegido.latitud},${elegido.longitud}`} target="_blank" rel="noreferrer">
              <Icono nombre="ubicacion" size={17} /><span>Abrir ubicación <small>{elegido.latitud.toFixed(5)}, {elegido.longitud.toFixed(5)}</small></span><span aria-hidden="true">↗</span></a>}

            <div className="flota-recorrido">
              <div className="flota-seccion-titulo"><div><h3>Recorrido por día</h3><p>Consulta las posiciones registradas en los últimos 31 días.</p></div>
                {recorrido && <button type="button" className="btn pequeno" onClick={() => setRecorrido(null)}>Quitar recorrido</button>}</div>
              <form className="flota-recorrido-form" onSubmit={(e) => { e.preventDefault(); void cargarRecorrido(); }}>
                <div><label htmlFor="fecha-recorrido">Día del recorrido</label><input id="fecha-recorrido" type="date" value={fecha} min={fechaMin.toISOString().slice(0, 10)} max={hoyISO()}
                  required onChange={(e) => setFecha(e.target.value)} /></div>
                <button className="btn primario" disabled={cargandoRuta || !fecha || sesionCaducada}>{cargandoRuta ? "Consultando…" : "Ver recorrido"}<Icono nombre="flecha" size={18} /></button>
              </form>
              {errorRuta && <p className="error" role="alert">{errorRuta}</p>}
              {recorrido && <div className="flota-recorrido-resultado" role="status">
                {recorrido.avisos.map((a, i) => <p className="aviso" key={i}>{a}</p>)}
                {recorrido.puntos.length ? <><div className="flota-recorrido-extremos"><span><b>A</b> Primera señal <strong>{fechaFlota(recorrido.puntos[0].fecha)}</strong></span>
                  <span><b>B</b> Última señal <strong>{fechaFlota(recorrido.puntos.at(-1)!.fecha)}</strong></span></div>
                  <p className="hint">{numeroFlota(recorrido.puntos_totales)} posiciones registradas{recorrido.simplificado ? ` · ${numeroFlota(recorrido.puntos.length)} representadas para facilitar la lectura` : ""}. Las líneas unen posiciones; no indican el itinerario exacto entre ellas.</p></>
                  : <p className="hint">No hay posiciones disponibles para esta matrícula en el día elegido.</p>}
              </div>}
            </div>
          </div>}
        </section>
      </div>
    </>}
    <p className="flota-nota-final">Información de Movildata · Los datos se muestran con la fecha de su última lectura. «—» significa que el dato no está disponible.</p>
  </>;
}
