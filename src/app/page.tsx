import Cabecera from "./Cabecera";
import { AREAS } from "@/lib/permisos";
import { usuarioActual } from "@/lib/usuario";

export const dynamic = "force-dynamic";

export default async function Inicio() {
  const { perfil, veArea } = await usuarioActual();
  const nombre = perfil?.nombre || perfil?.email || perfil?.codigo || "";
  // Cada área del catálogo aparece si alguno de sus perfiles le da algún permiso de ella.
  const mias = AREAS.filter((a) => veArea(a.id));

  return (
    <>
      <Cabecera nombre={nombre} admin={veArea("admin")} />
      <main className="contenido">
        <h1>Hola{nombre ? `, ${nombre.split(" ")[0]}` : ""}</h1>
        {!perfil || !perfil.activo ? (
          <p className="aviso">Tu usuario está pendiente de activar. Avisa a la oficina para que te den acceso.</p>
        ) : mias.length === 0 ? (
          <p className="aviso">Todavía no tienes acceso a ninguna parte de la app. Pide a la oficina que te asigne un perfil.</p>
        ) : (
          <>
            <p className="lead">Elige qué quieres hacer.</p>
            <nav className="modulos">
              {mias.map((a) => (
                // Enlace normal: la PWA de DECA no es una página de Next.
                <a key={a.id} className="modulo" href={a.ruta}>
                  <h2>{a.nombre}</h2>
                  <p>{a.descripcion}</p>
                </a>
              ))}
            </nav>
          </>
        )}
      </main>
    </>
  );
}
