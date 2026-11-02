import Link from "next/link";
import Cabecera from "../Cabecera";
import { conPermiso } from "@/lib/usuario";
import { duracion, estadoDe, hora, inicioDia, jornadaEnCurso, minutosTrabajados, NOMBRE_ESTADO, type Fichaje } from "@/lib/jornada";
import { llamarPython } from "@/lib/python";
import { empezarConCamion, finalizarJornada } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi camión · Grupo Trimodos" };

type Hoy = {
  simulado: boolean;
  tarjeta: { vehiculo_id: number; matricula: string; desde: string } | null;
  resumen: { conduccion_horas: number; km: number; pausa_en_horas: number; limite_diario_horas: number } | null;
};

const horasMin = (h: number) => duracion(Math.round(h * 60));

export default async function PaginaChofer({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, uid, perfil, veArea } = await conPermiso("chofer.usar");
  const { ok, error } = await searchParams;
  const [{ data: abierta }, { data: vehs }, { data: f }, movil] = await Promise.all([
    supabase.from("asignaciones").select("id,inicio,origen,vehiculos(matricula,modelo)").eq("usuario_id", uid).is("fin", null).maybeSingle(),
    supabase.from("vehiculos").select("id,matricula,modelo").eq("activo", true).order("matricula"),
    supabase.from("fichajes").select("id,usuario_id,tipo,momento,origen,nota,odoo_estado,odoo_error")
      .eq("usuario_id", uid).gte("momento", inicioDia(1).toISOString()).order("momento"),
    llamarPython<Hoy>("/api/chofer/hoy"),
  ]);
  const camion = abierta as unknown as { id: number; inicio: string; origen: string; vehiculos: { matricula: string; modelo: string | null } } | null;
  const vehiculos = (vehs ?? []) as { id: number; matricula: string; modelo: string | null }[];
  const fichajes = (f ?? []) as Fichaje[];
  const estado = estadoDe(fichajes);
  const hoyF = estado === "fuera" ? fichajes.filter((x) => new Date(x.momento).getTime() >= inicioDia().getTime()) : jornadaEnCurso(fichajes);
  const tarjeta = movil?.tarjeta;
  const r = movil?.resumen;

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.codigo || ""} admin={veArea("admin")} />
      <main className="contenido estrecho">
        <h1>Mi camión</h1>
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {movil?.simulado && <p className="hint">Datos de Movildata simulados (modo prueba).</p>}

        {camion ? (
          <section className="panel estado-jornada trabajando">
            <p className="hint">Conduciendo</p>
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
        ) : (
          <p className="aviso">No detectamos tu tarjeta en ningún camión. Elige la matrícula abajo.</p>
        )}

        {r && (
          <section className="cifras">
            <div className="panel"><b>{horasMin(r.conduccion_horas)}</b><span>Conducción hoy (máx. {r.limite_diario_horas} h)</span></div>
            <div className="panel"><b>{r.km} km</b><span>Hoy</span></div>
            <div className="panel"><b>{horasMin(r.pausa_en_horas)}</b><span>Hasta la pausa obligatoria</span></div>
            <div className="panel"><b>{duracion(minutosTrabajados(hoyF))}</b><span>Jornada fichada</span></div>
          </section>
        )}

        <details className="panel" open={!camion && !tarjeta}>
          <summary>{camion ? "Cambiar de camión" : "No es mi camión / no llevo tarjeta"}</summary>
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
