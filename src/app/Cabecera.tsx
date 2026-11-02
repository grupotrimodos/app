import Link from "next/link";

export default function Cabecera({ nombre, admin }: { nombre?: string; admin?: boolean }) {
  return (
    <header className="marca">
      <Link href="/" aria-label="Inicio">
        <img src="/deca/img/trimodos.png" alt="Grupo Trimodos" />
      </Link>
      {nombre !== undefined && (
        <div className="usuario">
          <span>{nombre}</span>
          {admin && <Link href="/admin" style={{ color: "#121417" }}>Administración</Link>}
          <form action="/salir" method="post">
            <button className="btn pequeno" style={{ color: "#121417", borderColor: "#c9ced5" }}>Salir</button>
          </form>
        </div>
      )}
    </header>
  );
}
