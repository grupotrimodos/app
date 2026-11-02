import Link from "next/link";
import Cabecera from "./Cabecera";
import Icono, { ICONOS_AREA } from "./Icono";
import { AREAS } from "@/lib/permisos";
import { usuarioActual } from "@/lib/usuario";
import { duracion, estadoDe, inicioDia, jornadaEnCurso, minutosTrabajados, NOMBRE_ESTADO, type Fichaje } from "@/lib/jornada";

export const dynamic = "force-dynamic";

const detalles: Record<string, { titulo: string; descripcion: string; etiqueta: string }> = {
  flota: { titulo: "Centro de flota", descripcion: "Localiza cada vehículo y consulta su última actividad en Movildata.", etiqueta: "OPERACIONES" },
  chofer: { titulo: "Mi camión", descripcion: "Confirma tu vehículo y gestiona tu jornada desde la cabina.", etiqueta: "EN CARRETERA" },
  deca: { titulo: "Órdenes de transporte", descripcion: "Revisa la mercancía, actualiza la carga y descarga tu documentación.", etiqueta: "DECA" },
  fichaje: { titulo: "Fichaje", descripcion: "Registra tu entrada, tus pausas y la salida. Todo queda anotado.", etiqueta: "MI JORNADA" },
  ausencias: { titulo: "Vacaciones y ausencias", descripcion: "Solicita tus días y sigue la respuesta de tu responsable.", etiqueta: "MI TIEMPO" },
  equipo: { titulo: "Mi equipo", descripcion: "Consulta la jornada de tu equipo y atiende sus solicitudes.", etiqueta: "PERSONAS" },
  admin: { titulo: "Administración", descripcion: "Gestiona los accesos, los centros, los vehículos y la sincronización.", etiqueta: "GESTIÓN" },
};
const orden = ["flota", "chofer", "deca", "fichaje", "ausencias", "equipo", "admin"];

export default async function Inicio() {
  const { perfil, veArea, puede, supabase, uid } = await usuarioActual();
  const nombre = perfil?.nombre || perfil?.email || perfil?.codigo || "";
  const mias = AREAS.filter((a) => veArea(a.id)).sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id));
  const puedeJornada = puede("fichaje.fichar", "chofer.usar");
  const [registro, solicitudes] = await Promise.all([
    puedeJornada ? supabase.from("fichajes").select("tipo,momento").eq("usuario_id", uid)
      .gte("momento", inicioDia(1).toISOString()).order("momento") : null,
    puede("ausencias.pedir") ? supabase.from("ausencias").select("id", { count: "exact", head: true })
      .eq("usuario_id", uid).eq("estado", "pendiente") : null,
  ]);
  const fichajes = (registro?.data ?? []) as Fichaje[];
  const estado = estadoDe(fichajes);
  const desdeHoy = inicioDia().getTime();
  const jornada = estado === "fuera" ? fichajes.filter((f) => new Date(f.momento).getTime() >= desdeHoy) : jornadaEnCurso(fichajes);
  const ahora = new Date();
  const h = Number(ahora.toLocaleString("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }));
  const saludo = h < 13 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches";
  const fecha = ahora.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" });
  const destacado = veArea("flota") ? "flota" : veArea("chofer") ? "chofer" : veArea("deca") ? "deca" : mias[0]?.id;
  const destino = mias.find((a) => a.id === destacado);

  return <>
    <Cabecera nombre={nombre} admin={veArea("admin")} />
    <main className="contenido inicio-contenido">
      <div className="inicio-bienvenida">
        <div><p className="inicio-antetitulo">GRUPO TRIMODOS · CENTRO DE TRABAJO</p>
          <h1>{saludo}{nombre ? `, ${nombre.split(/[ @]/)[0]}` : ""}.</h1>
          <p className="lead">Tu equipo, tu jornada y tus operaciones. Todo a mano.</p>
        </div>
        <div className="inicio-fecha"><Icono nombre="calendario" size={19} /><span>{fecha}</span></div>
      </div>

      {!perfil || !perfil.activo ? <section className="panel inicio-sin-acceso"><Icono nombre="escudo" size={36} />
        <h2>Estamos preparando tu acceso</h2><p>Tu usuario está pendiente de activar. Avisa a la oficina para empezar a usar tus herramientas.</p>
      </section> : mias.length === 0 ? <section className="panel inicio-sin-acceso"><Icono nombre="equipo" size={36} />
        <h2>Tu espacio está listo</h2><p>Pide a la oficina que te asigne un perfil para ver las herramientas de tu puesto.</p>
      </section> : <>
        <div className="inicio-resumen">
          <section className="inicio-destacado">
            <div className="inicio-destacado-texto">
              <span className="inicio-distintivo"><span />{destacado === "flota" ? "VISIÓN DE FLOTA" : "TU DÍA, CONECTADO"}</span>
              <h2>{destacado === "flota" ? <>Cada vehículo.<br />Una visión completa.</> : destacado === "chofer" ? <>Tu jornada empieza<br />con tu camión.</> : <>Todo preparado.<br />Sigamos avanzando.</>}</h2>
              <p>{destacado === "flota" ? "Consulta la posición, el estado y los datos disponibles de tus vehículos desde un mismo lugar."
                : destacado === "chofer" ? "Confirma la matrícula, registra tu entrada y ten a mano la información de tu vehículo."
                : "Accede a las herramientas de tu puesto y resuelve las gestiones del día sin perder el ritmo."}</p>
              {destino && <a className="btn primario" href={destino.ruta}>{destacado === "flota" ? "Abrir centro de flota" : destacado === "chofer" ? "Ir a mi camión" : `Abrir ${detalles[destacado ?? ""]?.titulo ?? destino.nombre}`}<Icono nombre="flecha" size={19} /></a>}
            </div>
            <div className="inicio-trazado" aria-hidden="true">
              <div className="inicio-trazado-linea" /><div className="inicio-trazado-circulo uno" /><div className="inicio-trazado-circulo dos" />
              <span className="inicio-trazado-icono"><Icono nombre="camion" size={54} /></span>
              <span className="inicio-trazado-origen"><Icono nombre="ubicacion" size={23} /></span>
              <span className="inicio-trazado-final"><Icono nombre="check" size={21} /></span>
            </div>
          </section>
          <section className="panel inicio-mi-dia" aria-labelledby="mi-dia-titulo">
            <div className="inicio-card-heading"><span className="inicio-icono"><Icono nombre="reloj" /></span><h2 id="mi-dia-titulo">Mi día</h2></div>
            {puedeJornada ? <>
              <span className={`inicio-estado ${!registro?.error ? estado : ""}`}><i />{registro?.error ? "Sin datos de jornada" : NOMBRE_ESTADO[estado]}</span>
              <p className="inicio-tiempo">{registro?.error ? "—" : duracion(minutosTrabajados(jornada))}</p>
              <p className="hint">{estado === "fuera" ? "Tiempo registrado hoy" : "Tiempo de tu jornada en curso"}</p>
              <Link className="inicio-enlace" href={puede("fichaje.fichar") ? "/fichaje" : "/chofer"}>Gestionar mi jornada<Icono nombre="flecha" size={18} /></Link>
            </> : <><p className="inicio-herramientas-total">{mias.length}<span>herramientas disponibles</span></p><p className="hint">Los accesos que necesitas, según tu puesto.</p></>}
            {solicitudes && <Link className="inicio-pendientes" href="/ausencias"><Icono nombre="calendario" size={19} />
              <span>{solicitudes.error ? "Consultar mis solicitudes" : `${solicitudes.count ?? 0} ${(solicitudes.count ?? 0) === 1 ? "solicitud pendiente" : "solicitudes pendientes"}`}</span><Icono nombre="flecha" size={16} />
            </Link>}
          </section>
        </div>

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
