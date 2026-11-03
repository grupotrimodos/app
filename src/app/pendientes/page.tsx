import Link from "next/link";
import { redirect } from "next/navigation";
import Cabecera from "../Cabecera";
import Icono from "../Icono";
import { fecha, hora } from "@/lib/jornada";
import { misPendientes } from "@/lib/pendientes";
import { usuarioActual } from "@/lib/usuario";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pendientes · Grupo Trimodos" };

export default async function Pendientes() {
  const [{ perfil, veArea }, { tareas, novedades }] = await Promise.all([usuarioActual(), misPendientes()]);
  if (!perfil?.activo) redirect("/");
  const porHacer = tareas.filter((t) => t.cantidad);
  const alDia = tareas.filter((t) => t.cantidad === 0);

  return <>
    <Cabecera nombre={perfil.nombre || perfil.email || perfil.codigo || ""} admin={veArea("admin")} />
    <main className="contenido estrecho">
      <h1>Pendientes</h1>
      <p className="lead">Lo que te toca resolver y las respuestas a lo que has pedido en los últimos 7 días.</p>

      <section className="panel">
        <h2>Por hacer</h2>
        {porHacer.length === 0 ? <p className="hint">No tienes nada pendiente.</p> : <ul className="lista-pendientes">
          {porHacer.map((t) => <li key={t.id}>
            <Link href={t.href}>
              <span className="pendiente-icono"><Icono nombre={t.icono} size={20} /></span>
              <span className="pendiente-texto"><b>{t.titulo}</b><span className="hint">{t.detalle}</span></span>
              <span className="pendiente-cuenta">{t.cantidad}</span>
              <Icono nombre="flecha" size={18} />
            </Link>
          </li>)}
        </ul>}
        {alDia.length > 0 && <p className="hint" style={{ marginTop: 12 }}>Al día: {alDia.map((t) => t.titulo.toLowerCase()).join(", ")}.</p>}
      </section>

      <section className="panel">
        <h2>Novedades</h2>
        {novedades.length === 0 ? <p className="hint">Nada nuevo esta semana.</p> : <ul className="lista-pendientes">
          {novedades.map((n, i) => <li key={i}>
            <Link href={n.href}>
              <span className={`pendiente-icono ${n.bien === true ? "bien" : n.bien === false ? "mal" : ""}`}>
                <Icono nombre={n.bien === false ? "aviso" : "check"} size={20} />
              </span>
              <span className="pendiente-texto"><b>{n.texto}</b><span className="hint">{fecha(n.cuando)}, {hora(n.cuando)}</span></span>
              <Icono nombre="flecha" size={18} />
            </Link>
          </li>)}
        </ul>}
      </section>
    </main>
  </>;
}
