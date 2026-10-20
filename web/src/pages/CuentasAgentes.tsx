import Supervisores from "./Supervisores";

// Sección "Agentes" (20/10/2026, pedido de Leo): cuentas de agentes individuales. Es la misma pantalla y el mismo motor
// de las cuentas de supervisores (ver repo/supervisores.ts), en modo AGENTES: el titular es el propio agente.
export default function CuentasAgentes() {
  return <Supervisores modo="AGENTES" />;
}
