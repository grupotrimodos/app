import Link from "next/link";
import Cabecera from "../Cabecera";
import { conPermiso } from "@/lib/usuario";
import { duracion, estadoDe, hora, inicioDia, jornadaEnCurso, minutosTrabajados, NOMBRE_ESTADO, type Fichaje } from "@/lib/jornada";
import { llamarPythonDetalle } from "@/lib/python";
import { fechaFlota, numeroFlota, NOMBRE_ESTADO_FLOTA, tienePosicion, type VehiculoFlota } from "@/lib/flota";
import { empezarConCamion, finalizarJornada } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi camión · Grupo Trimodos" };

type Hoy = {
  simulado: boolean;
  tarjeta: { vehiculo_id: number; matricula: string; desde: string } | null;
  resumen: { conduccion_horas: number; km: number; pausa_en_horas: number; limite_diario_horas: number } | null;
  vehiculo: VehiculoFlota | null;
  aviso: string | null;
};

const horasMin = (h: number) => duracion(Math.round(h * 60));

export default async function PaginaChofer({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, uid, perfil, veArea } = await conPermiso("chofer.usar");
  const { ok, error } = await searchParams;
  const [{ data: abierta }, { data: vehs }, { data: f }, consulta] = await Promise.all([
    supabase.from("asignaciones").select("id,inicio,origen,vehiculos(matricula,modelo)").eq("usuario_id", uid).is("fin", null).maybeSingle(),
    supabase.from("vehiculos").select("id,matricula,modelo").eq("activo", true).order("matricula"),
    supabase.from("fichajes").select("id,usuario_id,tipo,momento,origen,nota,odoo_estado,odoo_error")
      .eq("usuario_id", uid).gte("momento", inicioDia(1).toISOString()).order("momento"),
    llamarPythonDetalle<Hoy>("/api/chofer/hoy", { espera: 25000 }),
  ]);
  const camion = abierta as unknown as { id: number; inicio: string; origen: string; vehiculos: { matricula: string; modelo: string | null } } | null;
  const vehiculos = (vehs ?? []) as { id: number; matricula: string; modelo: string | null }[];
  const fichajes = (f ?? []) as Fichaje[];
  const estado = estadoDe(fichajes);
  const hoyF = estado === "fuera" ? fichajes.filter((x) => new Date(x.momento).getTime() >= inicioDia().getTime()) : jornadaEnCurso(fichajes);
  const movil = consulta.datos;
  const tarjeta = movil?.tarjeta;
  const r = movil?.resumen;
  const telemetria = movil?.vehiculo;

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.codigo || ""} admin={veArea("admin")} />
      <main className="contenido estrecho">
        <div className="pagina-titulo"><span className="eyebrow">En carretera</span><h1>Mi camión</h1>
          <p>Tu vehículo y tu jornada, a mano.</p></div>
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {movil?.simulado && <p className="aviso">Modo de prueba: la tarjeta y los datos de conducción son simulados.</p>}
        {consulta.error && <p className="aviso" role="status">{consulta.error} Puedes confirmar tu camión y registrar la jornada.</p>}
        {movil?.aviso && <p className="hint">{movil.aviso}</p>}

        {camion ? (
          <section className="panel estado-jornada trabajando">
            <p className="hint">Tu camión confirmado</p>
            <p className="matricula">{camion.vehiculos.matricula}</p>
            <p>{camion.vehiculos.modelo ?? ""} · desde las {hora(camion.inicio)}</p>
            {tarjeta && tarjeta.vehiculo_id && tarjeta.matricula !== camion.vehiculos.matricula && (
              <p className="aviso">Tu tarjeta está ahora en <b>{tarjeta.matricula}</b>. Si has cambiado de camión, confírmalo abajo.</p>
            )}
          </section>
        ) : tarjeta ? (
          <section className="panel estado-jornada">
            <p className="hint">Tu camión de hoy, según tu tarjeta del tacógrafo</p>
            <p className="matricula">{tarjeta.matricula}</p>
            <form action={empezarConCamion}>
              <input type="hidden" name="vehiculo_id" value={tarjeta.vehiculo_id} />
              <input type="hidden" name="origen" value="tacografo" />
              <button className="btn primario ancho grande">Sí, es mi camión</button>
            </form>
            <p className="hint" style={{ marginTop: 10 }}>
              {estado === "fuera" ? "Al confirmarlo se ficha tu entrada." : `Ya habías fichado (${NOMBRE_ESTADO[estado].toLowerCase()}).`}
            </p>
          </section>
        ) : movil?.simulado ? (
          <p className="aviso">No detectamos tu tarjeta en ningún camión. Elige la matrícula abajo.</p>
        ) : null}

        {telemetria && <section className="panel">
          <h2>Estado del vehículo</h2>
          <p><span className={`etiqueta ${telemetria.estado === "en_ruta" ? "ok" : ""}`}>{NOMBRE_ESTADO_FLOTA[telemetria.estado]}</span></p>
          <div className="cifras">
            <div><b>{numeroFlota(telemetria.km_hoy)} <small>km</small></b><span>Recorridos hoy</span></div>
            <div><b>{numeroFlota(telemetria.combustible_pct)} <small>%</small></b><span>Último nivel de combustible</span></div>
            <div><b>{numeroFlota(telemetria.velocidad_kmh)} <small>km/h</small></b><span>Velocidad en la última señal</span></div>
            <div><b>{numeroFlota(telemetria.consumo_medio_l_100km, 1)}</b><span>Litros / 100 km hoy</span></div>
          </div>
          <p className="hint">Posición: {fechaFlota(telemetria.fecha_posicion)}.<br />Combustible: {fechaFlota(telemetria.fecha_combustible)}.<br />Actividad de hoy hasta: {fechaFlota(telemetria.datos_hoy_hasta)}.</p>
          {telemetria.avisos.map((aviso, i) => <p className="hint" key={i}>{aviso}</p>)}
          {tienePosicion(telemetria) && <a className="btn ancho" target="_blank" rel="noopener noreferrer"
            href={`https://www.google.com/maps/search/?api=1&query=${telemetria.latitud},${telemetria.longitud}`}>Ver última posición en el mapa</a>}
          <p className="hint" style={{ marginTop: 12 }}>Datos del vehículo; los tiempos de conducción y descanso se consultan en el tacógrafo.</p>
        </section>}

        {!r && <section className="panel"><p className="hint">Tu jornada registrada</p>
          <p className="estado-grande">{duracion(minutosTrabajados(hoyF))}</p>
          <span className="etiqueta">{NOMBRE_ESTADO[estado]}</span>
        </section>}

        {r && (
          <section className="cifras">
            <div className="panel"><b>{horasMin(r.conduccion_horas)}</b><span>Conducción hoy (máx. {r.limite_diario_horas} h)</span></div>
            <div className="panel"><b>{r.km} km</b><span>Hoy</span></div>
            <div className="panel"><b>{horasMin(r.pausa_en_horas)}</b><span>Hasta la pausa obligatoria</span></div>
            <div className="panel"><b>{duracion(minutosTrabajados(hoyF))}</b><span>Jornada fichada</span></div>
          </section>
        )}

        <details className="panel" open={!camion && !tarjeta}>
          <summary>{camion ? "Cambiar de camión" : tarjeta ? "Elegir otro camión" : "Confirmar mi camión"}</summary>
          {vehiculos.length === 0 ? <p className="hint">No hay camiones dados de alta. Avisa a la oficina.</p> : (
            <form action={empezarConCamion}>
              <input type="hidden" name="origen" value="manual" />
              <label htmlFor="vehiculo_id">Matrícula</label>
              <select id="vehiculo_id" name="vehiculo_id" required defaultValue="">
                <option value="" disabled>Elige el camión</option>
                {vehiculos.filter((v) => v.matricula !== camion?.vehiculos.matricula)
                  .map((v) => <option key={v.id} value={v.id}>{v.matricula}{v.modelo ? ` · ${v.modelo}` : ""}</option>)}
              </select>
              <button className="btn primario ancho" style={{ marginTop: 14 }}>{camion ? "Cambiar a este camión" : "Empezar con este camión"}</button>
            </form>
          )}
        </details>

        {camion && (
          <form action={finalizarJornada}>
            <button className="btn ancho grande">Terminar la jornada</button>
            <p className="hint">Se cierra el camión y se ficha tu salida. Para las pausas, usa <Link href="/fichaje">Fichaje</Link>.</p>
          </form>
        )}
      </main>
    </>
  );
}
