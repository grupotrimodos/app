"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NOMBRE_ESTADO_FLOTA, tienePosicion, type PuntoRecorrido, type VehiculoFlota } from "@/lib/flota";

type Vista = { x: number; y: number; z: number };
const ALTO = 420;
// Web Mercator, coordenadas normalizadas. La cartografía se descarga solo para la vista visible.
function proyectar(lat: number, lon: number) {
  const seno = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180);
  return { x: (lon + 180) / 360, y: .5 - Math.log((1 + seno) / (1 - seno)) / (4 * Math.PI) };
}

function encuadre(puntos: { latitud: number; longitud: number }[], ancho: number): Vista {
  if (!puntos.length) return { ...proyectar(40.2, -3.5), z: 5 };
  const p = puntos.map((p) => proyectar(p.latitud, p.longitud));
  const xs = p.map((p) => p.x), ys = p.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const z = Math.floor(Math.log2(Math.min(Math.max(180, ancho - 150) / (256 * Math.max(.00005, maxX - minX)),
    (ALTO - 150) / (256 * Math.max(.00005, maxY - minY)))));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: Math.max(3, Math.min(13, z)) };
}

export default function MapaFlota({ vehiculos, seleccionado, puntos, seleccionar }: {
  vehiculos: VehiculoFlota[]; seleccionado: string | null; puntos: PuntoRecorrido[];
  seleccionar: (id: string) => void;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(700);
  const [vista, setVista] = useState<Vista>({ ...proyectar(40.2, -3.5), z: 5 });
  const [errorMapa, setErrorMapa] = useState(false);
  const arrastre = useRef<{ x: number; y: number; vista: Vista } | null>(null);
  const localizados = useMemo(() => vehiculos.filter(tienePosicion), [vehiculos]);
  const ruta = useMemo(() => puntos.filter(tienePosicion), [puntos]);
  const objetivo = ruta.length ? ruta : localizados;
  const objetivoRef = useRef(objetivo);
  objetivoRef.current = objetivo;
  const identidad = ruta.length ? `${seleccionado}:${ruta[0].fecha}:${ruta.at(-1)?.fecha}` : localizados.map((v) => v.id).join(",");

  useEffect(() => {
    if (!contenedor.current) return;
    const observer = new ResizeObserver(([e]) => setAncho(e.contentRect.width));
    observer.observe(contenedor.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setVista(encuadre(objetivoRef.current, ancho)); }, [identidad, ancho]);

  const escala = 256 * 2 ** vista.z;
  const izquierda = vista.x * escala - ancho / 2;
  const arriba = vista.y * escala - ALTO / 2;
  const posicion = (p: { latitud: number; longitud: number }) => {
    const q = proyectar(p.latitud, p.longitud);
    return { x: q.x * escala - izquierda, y: q.y * escala - arriba };
  };
  const teselas = [];
  for (let y = Math.floor(arriba / 256); y <= Math.floor((arriba + ALTO) / 256); y++) {
    for (let x = Math.floor(izquierda / 256); x <= Math.floor((izquierda + ancho) / 256); x++) {
      if (y < 0 || y >= 2 ** vista.z || x < 0 || x >= 2 ** vista.z) continue;
      teselas.push({ x, y, izquierda: x * 256 - izquierda, arriba: y * 256 - arriba });
    }
  }

  return <div className="flota-mapa" ref={contenedor} aria-label="Mapa de posiciones de la flota">
    <div className="flota-mapa-superficie" tabIndex={0} role="region"
      aria-label="Mapa. Usa las flechas del teclado para desplazarte y los botones para acercar o alejar."
      onKeyDown={(e) => {
        const pasos: Record<string, [number, number]> = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] };
        const paso = pasos[e.key];
        if (!paso) return;
        e.preventDefault();
        setVista((v) => ({ ...v, x: Math.max(0, Math.min(1, v.x + paso[0] / escala)), y: Math.max(0, Math.min(1, v.y + paso[1] / escala)) }));
      }} onPointerDown={(e) => {
      if (e.button !== 0) return;
      arrastre.current = { x: e.clientX, y: e.clientY, vista };
      e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={(e) => {
      const a = arrastre.current;
      if (!a) return;
      setVista({ ...a.vista, x: Math.max(0, Math.min(1, a.vista.x - (e.clientX - a.x) / escala)),
        y: Math.max(0, Math.min(1, a.vista.y - (e.clientY - a.y) / escala)) });
    }} onPointerUp={() => { arrastre.current = null; }} onPointerCancel={() => { arrastre.current = null; }}>
      {teselas.map((t) => <img key={`${vista.z}/${t.x}/${t.y}`} alt="" draggable={false}
        referrerPolicy="origin" width={256} height={256}
        src={`https://tile.openstreetmap.org/${vista.z}/${t.x}/${t.y}.png`}
        style={{ left: t.izquierda, top: t.arriba }} onError={() => setErrorMapa(true)} />)}
    </div>
    {ruta.length > 0 && <svg className="flota-mapa-trazado" viewBox={`0 0 ${ancho} ${ALTO}`} aria-label="Recorrido registrado">
      <polyline points={ruta.map((p) => { const q = posicion(p); return `${q.x},${q.y}`; }).join(" ")}
        fill="none" stroke="white" strokeWidth="8" strokeLinejoin="round" />
      <polyline points={ruta.map((p) => { const q = posicion(p); return `${q.x},${q.y}`; }).join(" ")}
        fill="none" stroke="#263e54" strokeWidth="4" strokeLinejoin="round" />
      {[ruta[0], ruta[ruta.length - 1]].map((p, i) => {
        const q = posicion(p);
        return <g key={i}><circle cx={q.x} cy={q.y} r="12" fill={i ? "#fcda00" : "#142332"} stroke="white" strokeWidth="3" />
          <text x={q.x} y={q.y + 4} textAnchor="middle" fill={i ? "#142332" : "white"} fontSize="11" fontWeight="700">{i ? "B" : "A"}</text></g>;
      })}
    </svg>}
    {localizados.map((v) => {
      const p = posicion(v);
      if (p.x < -50 || p.x > ancho + 50 || p.y < -30 || p.y > ALTO + 30) return null;
      return <button type="button" key={v.id} className={`flota-marcador ${v.id === seleccionado ? "seleccionado" : ""} ${v.estado}`}
        style={{ left: p.x, top: p.y }} onClick={() => seleccionar(v.id)} aria-pressed={v.id === seleccionado}
        aria-label={`${v.matricula}, ${NOMBRE_ESTADO_FLOTA[v.estado]}`}><span />{v.matricula}</button>;
    })}
    <div className="flota-mapa-titulo"><span className="flota-punto" />{ruta.length ? "Recorrido registrado" : "Últimas posiciones"}</div>
    <div className="flota-mapa-controles">
      <button type="button" title="Acercar mapa" aria-label="Acercar mapa" disabled={vista.z >= 17} onClick={() => setVista((v) => ({ ...v, z: v.z + 1 }))}>+</button>
      <button type="button" title="Alejar mapa" aria-label="Alejar mapa" disabled={vista.z <= 3} onClick={() => setVista((v) => ({ ...v, z: v.z - 1 }))}>−</button>
      <button type="button" className="flota-mapa-encuadrar" onClick={() => setVista(encuadre(objetivo, ancho))}>Centrar</button>
    </div>
    {(!localizados.length && !ruta.length || errorMapa) && <div className="flota-mapa-aviso">
      {errorMapa ? "El mapa base no está disponible. Puedes consultar las coordenadas y abrir la ubicación." : "Las posiciones aparecerán aquí cuando Movildata las facilite."}
    </div>}
    <div className="flota-mapa-credito">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></div>
  </div>;
}
