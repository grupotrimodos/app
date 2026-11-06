import Cabecera from "../Cabecera";
import { destinoSeguro } from "@/lib/destino";
import Icono from "../Icono";
import FormularioLogin from "./FormularioLogin";
import { ALCANCE_OUTLOOK, calendarioActivo } from "@/lib/outlook";

export const metadata = { title: "Entrar · Grupo Trimodos" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const destino = destinoSeguro(next);
  return <>
    <Cabecera />
    <main className="login-pagina">
      <section className="login-presentacion">
        <div className="login-presentacion-texto">
          <span className="inicio-distintivo"><span />EL ESPACIO DE NUESTRO EQUIPO</span>
          <h1>Juntos,<br />en movimiento<span>.</span></h1>
          <p>De la oficina a la carretera.<br />Tu trabajo diario, conectado.</p>
          <div className="login-promesas"><span><Icono nombre="camion" size={22} />Transporte</span><span><Icono nombre="ruta" size={22} />Logística</span><span><Icono nombre="equipo" size={22} />Personas</span></div>
        </div>
        <div className="login-vias" aria-hidden="true"><i /><i /><i /><span className="login-vias-nodo"><Icono nombre="camion" size={48} /></span><span className="login-vias-punto" /></div>
        <div className="login-presentacion-pie"><span>GRUPO TRIMODOS</span><span>Un equipo. Un mismo camino.</span></div>
      </section>
      <section className="login-acceso" aria-labelledby="titulo-acceso">
        <div className="login-acceso-heading"><span className="login-sello"><Icono nombre="escudo" size={22} /></span><p>ACCESO DEL EQUIPO</p></div>
        <h2 id="titulo-acceso">Te damos la bienvenida.</h2>
        <p className="lead">Entra para continuar con tu jornada.</p>
        {error && <p className="error" role="alert">No se ha podido iniciar sesión. Inténtalo de nuevo.</p>}
        <FormularioLogin destino={destino} alcance={calendarioActivo() ? ALCANCE_OUTLOOK : ""}
          google={process.env.LOGIN_GOOGLE === "true"} />
        <p className="login-privado"><Icono nombre="escudo" size={16} />Espacio privado de Grupo Trimodos</p>
      </section>
    </main>
  </>;
}
