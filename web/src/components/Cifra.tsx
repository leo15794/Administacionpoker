import { useEffect, useRef, useState } from "react";

// Cifra animada (27/10/2026, pedido de Leo): los números importantes no aparecen de golpe. Al abrir la pantalla se escriben dígito por dígito
// (cada uno gira desde el 0 hasta su valor) y cuando el valor cambia giran solo los dígitos que cambian, hacia arriba o hacia abajo. Los
// separadores y signos quedan fijos. Con "reducir movimiento" activado en el sistema, el número aparece directo.
// Alto de cada renglón en em: tiene que coincidir con .cifra en index.css.
const ALTO = 1.15;

function Digito({ v, idx, retraso }: { v: number; idx: number; retraso: number }) {
  const [mostrado, setMostrado] = useState(0);
  const inicial = useRef(true); // la primera vez entra con el retraso de la cifra; después, solo un escalón corto entre dígitos
  const cambios = useRef(0);
  useEffect(() => {
    if (cambios.current++ > 0) inicial.current = false;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setMostrado(v)));
    return () => cancelAnimationFrame(id);
  }, [v]);
  useEffect(() => {
    if (mostrado !== 0) inicial.current = false;
  }, [mostrado]);
  const delay = (inicial.current ? retraso : 0) + idx * 55;
  return (
    <span className="d" aria-hidden="true">
      <span className="col" style={{ transform: `translateY(${-mostrado * ALTO}em)`, transitionDelay: `${delay}ms` }}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <span key={n}>{n}</span>
        ))}
      </span>
    </span>
  );
}

export default function Cifra({ texto, retraso = 0 }: { texto: string; retraso?: number }) {
  const chars = [...String(texto)];
  const n = chars.length;
  return (
    <span className="cifra" role="img" aria-label={texto}>
      {chars.map((ch, i) =>
        /\d/.test(ch) ? (
          // la clave cuenta desde la derecha: si aparece un dígito más a la izquierda (999 -> 1.000) los demás conservan su columna
          <Digito key={n - i} v={Number(ch)} idx={i} retraso={retraso} />
        ) : (
          <span key={n - i} className="sep" aria-hidden="true">
            {ch === " " ? " " : ch}
          </span>
        )
      )}
    </span>
  );
}
