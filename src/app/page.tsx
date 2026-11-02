import Link from "next/link";
import Cabecera from "./Cabecera";
import { MODULOS } from "@/lib/modulos";
import { centrosQueGestiono, usuarioActual } from "@/lib/usuario";

export const dynamic = "force-dynamic";

export default async function Inicio() {
  const { supabase, uid, perfil } = await usuarioActual();
  const responsable = perfil?.activo ? (await centrosQueGestiono(supabase, uid, perfil.es_admin)).length > 0 : false;
  const nombre = perfil?.nombre || perfil?.email || perfil?.codigo || "";
  const mios = MODULOS.filter((m) => perfil?.activo && perfil.modulos.includes(m.id));

  return (
    <>
      <Cabecera nombre={nombre} admin={perfil?.es_admin && perfil.activo} />
      <main className="contenido">
        <h1>Hola{nombre ? `, ${nombre.split(" ")[0]}` : ""}</h1>
        {!perfil || !perfil.activo ? (
          <p className="aviso">Tu usuario está pendiente de activar. Avisa a la oficina para que te den acceso.</p>
        ) : mios.length === 0 && !responsable ? (
          <p className="aviso">Todavía no tienes acceso a ninguna parte de la app. Pide a la oficina que te lo active.</p>
        ) : (
          <>
            <p className="lead">Elige qué quieres hacer.</p>
            <nav className="modulos">
              {mios.map((m) => (
                // La PWA de DECA no es una página de Next: enlace normal, sin precarga.
                <a key={m.id} className="modulo" href={m.ruta}>
                  <h2>{m.nombre}</h2>
                  <p>{m.descripcion}</p>
                </a>
              ))}
              {responsable && (
                <Link className="modulo" href="/equipo">
                  <h2>Mi equipo</h2>
                  <p>Quién ha fichado hoy, ausencias por aprobar y correcciones.</p>
                </Link>
              )}
              {perfil.es_admin && (
                <Link className="modulo" href="/admin">
                  <h2>Administración</h2>
                  <p>Usuarios, centros, roles y accesos.</p>
                </Link>
              )}
            </nav>
          </>
        )}
      </main>
    </>
  );
}
