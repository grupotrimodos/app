import Link from "next/link";
import { AREAS } from "@/lib/permisos";
import { misPendientes } from "@/lib/pendientes";
import { usuarioActual } from "@/lib/usuario";
import Icono from "./Icono";
import Navegacion from "./Navegacion";

export default async function Cabecera({ nombre }: { nombre?: string; admin?: boolean }) {
  if (nombre === undefined) {
    return <header className="shell-public-header">
      <Link href="/" aria-label="Grupo Trimodos, inicio"><img src="/deca/img/trimodos.png" alt="Grupo Trimodos" /></Link>
      <span>Personas · Transporte · Logística</span>
    </header>;
  }
  const [{ enMenu }, { total }] = await Promise.all([usuarioActual(), misPendientes()]);
  const areas = AREAS.filter((a) => enMenu(a.id)).map(({ id, nombre, ruta }) => ({ id, nombre, ruta }));
  // Iniciales de las dos primeras palabras con letras (un «(ejemplo)» o un número no cuentan).
  const iniciales = nombre.trim().split(/\s+/).filter((p) => /^\p{L}/u.test(p)).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "GT";
  return (
    <div className="app-shell">
      <a className="shell-skip" href="#contenido-principal">Ir al contenido</a>
      <aside className="shell-sidebar">
        <Link className="shell-logo" href="/" aria-label="Grupo Trimodos, inicio">
          <img src="/deca/img/trimodos.png" alt="Grupo Trimodos" />
        </Link>
        <p className="shell-nav-label">ESPACIO DE TRABAJO</p>
        <Navegacion areas={areas} />
        <div className="shell-sidebar-footer"><span className="shell-brand-line" />
          <strong>En equipo, en movimiento.</strong><span>La conexión entre oficina y carretera.</span>
        </div>
      </aside>
      <header className="shell-header">
        <div className="shell-heading"><Icono nombre="actividad" size={20} /><span>Tu espacio Trimodos</span></div>
        <Link className={`shell-avisos ${total ? "con-avisos" : ""}`} href="/pendientes"
          aria-label={total ? `Pendientes: ${total}` : "Pendientes: nada"} title="Lo que tienes pendiente y tus novedades">
          <Icono nombre="campana" size={21} />{total > 0 && <span className="shell-avisos-cuenta">{total > 99 ? "99+" : total}</span>}
        </Link>
        <div className="shell-user">
          <span className="shell-avatar" aria-hidden="true">{iniciales}</span>
          <span className="shell-user-name">{nombre || "Mi cuenta"}</span>
          <form action="/salir" method="post">
            <button className="shell-logout" title="Cerrar sesión"><Icono nombre="salir" size={20} /><span>Salir</span></button>
          </form>
        </div>
      </header>
      <span id="contenido-principal" tabIndex={-1} />
    </div>
  );
}
