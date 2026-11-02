import Cabecera from "../Cabecera";
import FormularioLogin from "./FormularioLogin";

export const metadata = { title: "Entrar · Grupo Trimodos" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  // Solo rutas internas: evita redirecciones a otras webs.
  const destino = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <>
      <Cabecera />
      <main className="contenido estrecho">
        <h1>Entrar</h1>
        {error && <p className="error">No se ha podido iniciar sesión. Inténtalo de nuevo.</p>}
        <FormularioLogin destino={destino} />
      </main>
    </>
  );
}
