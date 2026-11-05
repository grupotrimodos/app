import Cabecera from "../Cabecera";
import CuadroDeMando from "../CuadroDeMando";
import { conPermiso } from "@/lib/usuario";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cuadro de mando · Grupo Trimodos" };

/** El cuadro de mando para quien lo tiene pero entra en otra pantalla (p. ej. oficina con permiso de dirección). */
export default async function Direccion({ searchParams }: { searchParams: Promise<{ ver?: string; empresa?: string }> }) {
  const { perfil } = await conPermiso("direccion.ver");
  const { ver, empresa } = await searchParams;
  return <>
    <Cabecera nombre={perfil.nombre || perfil.email || ""} />
    <main className="contenido inicio-contenido"><CuadroDeMando ver={ver} empresa={empresa} base="/direccion" /></main>
  </>;
}
