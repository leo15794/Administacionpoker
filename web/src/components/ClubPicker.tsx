import { useEffect, useRef, useState } from "react";

/**
 * Selector de club buscable — reemplaza el <select> nativo (que con muchos clubes obliga a
 * scrollear una lista larga y no deja buscar por texto) por un input con label, que al
 * escribir filtra los clubes en vivo y los muestra en un dropdown propio. Pedido de Leo
 * (21/09/2026): "es un poco feo al momento de buscar... queda muy escondido ahi arriba" sobre
 * el selector de club en Resumen por club.
 */
export function ClubPicker({
  clubes,
  value,
  onChange,
  label = "Club",
}: {
  clubes: { id: string; name: string }[];
  value: string;
  onChange: (clubId: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const seleccionado = clubes.find((c) => c.id === value);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const filtrados = query.trim()
    ? clubes.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    : clubes;

  function elegir(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="club-picker" ref={wrapRef}>
      <label>{label}</label>
      <input
        ref={inputRef}
        className="club-picker-input"
        value={open ? query : seleccionado?.name ?? ""}
        placeholder="Buscar club..."
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); setQuery(""); inputRef.current?.blur(); }
          if (e.key === "Enter" && filtrados.length === 1) { elegir(filtrados[0].id); inputRef.current?.blur(); }
        }}
      />
      {open && (
        <div className="club-picker-list">
          {filtrados.length === 0 && <div className="club-picker-empty">Sin resultados</div>}
          {filtrados.map((c) => (
            <div
              key={c.id}
              className={"club-picker-item" + (c.id === value ? " active" : "")}
              // onMouseDown (no onClick): dispara antes que el blur del input, si no el blur
              // cierra la lista primero y el click nunca llega a pegarle al item.
              onMouseDown={() => elegir(c.id)}
            >
              {c.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
