import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Shell from "./pages/Shell";
import Resumen from "./pages/Resumen";
import Agentes from "./pages/Agentes";
import Movimientos from "./pages/Movimientos";
import Cierres from "./pages/Cierres";
import Usuarios from "./pages/Usuarios";
import Tesoreria from "./pages/Tesoreria";
import Garantias from "./pages/Garantias";
import Adelantos from "./pages/Adelantos";
import CuentasSocios from "./pages/CuentasSocios";
import Wallet from "./pages/Wallet";
import MiCuenta from "./pages/MiCuenta";
import { api } from "./api";

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!api.getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
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
          <Route path="adelantos" element={<Adelantos />} />
          <Route path="cuentas-socios" element={<CuentasSocios />} />
          <Route path="usuarios" element={<Usuarios />} />
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

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
