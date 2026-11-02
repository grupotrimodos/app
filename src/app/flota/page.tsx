import Cabecera from "../Cabecera";
import { Suspense } from "react";
import { conPermiso } from "@/lib/usuario";
import { llamarPythonDetalle } from "@/lib/python";
import type { ResumenFlota } from "@/lib/flota";
import CentroFlota from "./CentroFlota";
import "./flota.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Centro de flota · Grupo Trimodos" };

async function Resumen() {
  const { datos, error } = await llamarPythonDetalle<ResumenFlota>("/api/flota/resumen", { espera: 25000 });
  return <CentroFlota inicial={datos} errorInicial={error} />;
}

export default async function PaginaFlota() {
  const { perfil, veArea } = await conPermiso("flota.ver");
  return <>
    <Cabecera nombre={perfil.nombre || perfil.codigo || ""} admin={veArea("admin")} />
    <main className="contenido flota-page" id="contenido">
      <Suspense fallback={<section className="panel flota-carga" role="status" aria-busy="true">
        <p className="flota-antetitulo">CENTRO DE FLOTA</p><h1>Conectando con tu flota</h1>
        <p className="lead">Estamos consultando las últimas posiciones y la actividad de tus vehículos. Puede tardar unos segundos.</p>
        <div className="flota-carga-barra" aria-hidden="true"><span /></div>
      </section>}><Resumen /></Suspense>
    </main>
  </>;
}
