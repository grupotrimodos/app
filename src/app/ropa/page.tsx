import { redirect } from "next/navigation";
import Cabecera from "../Cabecera";
import { MiRopa } from "./secciones";
import { nombreTemporada, temporadaActual } from "@/lib/ropa";
import { conPermiso } from "@/lib/usuario";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi ropa · Grupo Trimodos" };

const DE_GESTION = ["temporada", "cambios", "composicion"];

/** La ropa de cada persona: su dotación de temporada, sus tallas y sus cambios. La gestión está en Seguridad. */
export default async function Ropa({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; ver?: string }> }) {
  const { supabase, uid, perfil, esDeSuPuesto } = await conPermiso("ropa.pedir", "ropa.gestionar", "ropa.configurar");
  const { ok, error, ver } = await searchParams;
  // Quien no tiene ropa propia, o llega con un enlace antiguo a la gestión, va a Seguridad → Ropa y EPIs.
  if (!esDeSuPuesto("ropa.pedir") || DE_GESTION.includes(ver ?? "")) {
    redirect(`/seguridad?ver=ropa${DE_GESTION.includes(ver ?? "") ? `&ropa=${ver}` : ""}`);
  }
  const t = temporadaActual();
  // La dotación de la temporada se prepara sola (a quien le toque por su puesto); así siempre está al día.
  await supabase.rpc("preparar_dotaciones");
  return <>
    <Cabecera nombre={perfil.nombre || perfil.email || perfil.codigo || ""} />
    <main className="contenido estrecho">
      <h1>Mi ropa</h1>
      <p className="lead">Tu ropa de {nombreTemporada(t)}: dos mudas completas que te llegan sin pedirlas.</p>
      {ok && <p className="aviso" role="status">{ok}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <MiRopa uid={uid} temporada={t} />
    </main>
  </>;
}
