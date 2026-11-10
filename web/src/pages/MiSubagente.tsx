import { useEffect, useState } from "react";
import { api } from "../api";
import Loading from "../components/Loading";
import CierreAgenteCard from "../components/CierreAgenteCard";

// Portal del subagente (10/11/2026, pedido de Leo, mockup 87): igual que los agentes de un supervisor, solo sus cierres semanales con el
// desglose y sus jugadores, calculados con los % que le puso su agente. No ve al agente ni lo que le queda (ver repo/subagentes.ts).
export default function MiSubagente() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.miSubagente().then(setData).catch((e) => setError(e.message));
  }, []);
  if (error) return <div className="error">No se pudo cargar: {error}</div>;
  if (!data) return <Loading />;
  const cierres: any[] = data.cierres ?? [];
  return (
    <div>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div>
          <h2>Hola, {data.nombre}</h2>
          <div className="muted">Tocá un cierre para ver el desglose y tus jugadores</div>
        </div>
      </div>
      {cierres.length === 0 ? (
        <div className="muted">Todavía no hay cierres semanales cargados.</div>
      ) : (
        cierres.map((c: any, i: number) => <CierreAgenteCard key={c.id} c={c} abiertoInicial={i === 0} />)
      )}
    </div>
  );
}
