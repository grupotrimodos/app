import { createClient } from "@/lib/supabase/server";

/** «Lo aprueba: …» en las pantallas donde se pide algo, para que cada uno sepa a quién le llega su solicitud. */
export default async function QuienAprueba({ permiso, que }: { permiso: "ausencias.aprobar" | "ropa.gestionar"; que: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quien_me_aprueba", { permiso });
  if (error) return null;
  const quienes = (data ?? []) as { nombre: string; centro: string }[];
  return <p className={quienes.length ? "quien-aprueba" : "quien-aprueba sin-responsable"}>
    {quienes.length
      ? <>Tus {que} {quienes.length === 1 ? "le llegan a" : "les llegan a"} <b>{quienes.map((q) => `${q.nombre} (${q.centro})`).join(", ")}</b>.</>
      : <>Tu centro todavía no tiene responsable: de tus {que} se encarga <b>la administración</b>.</>}
  </p>;
}
