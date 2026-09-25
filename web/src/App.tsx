import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Shell from "./pages/Shell";
import Resumen from "./pages/Resumen";
import Agentes from "./pages/Agentes";
import Movimientos from "./pages/Movimientos";
import Cierres from "./pages/Cierres";
import Usuarios from "./pages/Usuarios";
import ComisionesReferidos from "./pages/ComisionesReferidos";
import ResumenFinanciero from "./pages/ResumenFinanciero";
// (25/09/2026, pedido de Leo: "necesito un login por fuera para esta seccion... asi no me
// sirve") -- TeamBack Affiliates se monta en una ruta TOTALMENTE APARTE más abajo (/teamback),
// fuera del <RequireAuth> y del <Shell> del sistema principal -- no pasa por /login ni por
// api.getToken() (el token del sistema principal). La propia página maneja su login (ver
// TeamBackAffiliates.tsx: TbLogin, tb_token/tb_session en localStorage).
import TeamBackAffiliates from "./pages/TeamBackAffiliates";
import Tesoreria from "./pages/Tesoreria";
import Garantias from "./pages/Garantias";
import Proveedores from "./pages/Proveedores";
import Adelantos from "./pages/Adelantos";
import RakebackPendiente from "./pages/RakebackPendiente";
import CuentasSocios from "./pages/CuentasSocios";
import GananciasPorPeriodo from "./pages/GananciasPorPeriodo";
import Liquidaciones from "./pages/Liquidaciones";
import StockDeudas from "./pages/StockDeudas";
import ResumenClub from "./pages/ResumenClub";
import JugadoresBancados from "./pages/JugadoresBancados";
import Rodeo from "./pages/Rodeo";
import ResumenAgentes from "./pages/ResumenAgentes";
import Wallet from "./pages/Wallet";
import MiCuenta from "./pages/MiCuenta";
import MiSupervision from "./pages/MiSupervision";
import { ConfirmProvider } from "./components/ConfirmProvider";
import { api } from "./api";

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!api.getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ConfirmProvider>
      <BrowserRouter>
        <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <Shell role="ADMIN" />
            </RequireAuth>
          }
        >
          <Route index element={<Resumen />} />
          <Route path="agentes" element={<Agentes />} />
          <Route path="movimientos" element={<Movimientos />} />
          <Route path="cierres" element={<Cierres />} />
          <Route path="tesoreria" element={<Tesoreria />} />
          <Route path="wallet" element={<Wallet />} />
          <Route path="garantias" element={<Garantias />} />
          <Route path="proveedores" element={<Proveedores />} />
          <Route path="adelantos" element={<Adelantos />} />
          <Route path="rakeback-pendiente" element={<RakebackPendiente />} />
          <Route path="cuentas-socios" element={<CuentasSocios />} />
          <Route path="ganancias-por-periodo" element={<GananciasPorPeriodo />} />
          <Route path="liquidaciones" element={<Liquidaciones />} />
          <Route path="stock-deudas" element={<StockDeudas />} />
          <Route path="resumen-club" element={<ResumenClub />} />
          <Route path="jugadores-bancados" element={<JugadoresBancados />} />
          <Route path="rodeo" element={<Rodeo />} />
          <Route path="resumen-agentes" element={<ResumenAgentes />} />
          <Route path="usuarios" element={<Usuarios />} />
          <Route path="comisiones-referidos" element={<ComisionesReferidos />} />
          <Route path="resumen-financiero" element={<ResumenFinanciero />} />
        </Route>

        <Route
          path="/mi-cuenta"
          element={
            <RequireAuth>
              <Shell role="AGENT" />
            </RequireAuth>
          }
        >
          <Route index element={<MiCuenta />} />
        </Route>

        <Route
          path="/mi-supervision"
          element={
            <RequireAuth>
              <Shell role="SUPERVISOR" />
            </RequireAuth>
          }
        >
          <Route index element={<MiSupervision />} />
        </Route>

        {/* (25/09/2026) TeamBack Affiliates -- sección TOTALMENTE APARTE, con su propio login
            (ver el comentario arriba del import). Fuera de RequireAuth a propósito: alguien con
            SOLO un usuario de esta sección entra directo por /teamback, sin tocar /login ni el
            resto de DigiPlayers. */}
        <Route path="/teamback/*" element={<TeamBackAffiliates />} />

        <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfirmProvider>
  );
}
