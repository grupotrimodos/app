import Link from "next/link";
import { AREAS } from "@/lib/permisos";
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
  const { veArea } = await usuarioActual();
  const areas = AREAS.filter((a) => veArea(a.id)).map(({ id, nombre, ruta }) => ({ id, nombre, ruta }));
  const iniciales = nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "GT";
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
