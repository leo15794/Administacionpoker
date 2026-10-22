// Íconos del menú con temática de póker (22/10/2026, pedido de Leo, opción "Mesa"): cartas, fichas, corona, herradura, etc. Mismo trazo y tamaño (24x24) para todos;
// el color y el relleno suave los pone el CSS del menú (.sidebar .nav-link svg en index.css). Las claves coinciden con las del objeto `icon` de Shell.tsx.
import type { ReactNode } from "react";

const base = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const S = ({ children }: { children: ReactNode }) => <svg {...base}>{children}</svg>;
const Glifo = ({ x, y, size, c }: { x: number; y: number; size: number; c: string }) => (
  <text x={x} y={y} fontSize={size} fontWeight={700} textAnchor="middle" fill="currentColor" stroke="none" fontFamily="Arial, sans-serif">{c}</text>
);

export const iconosPoker = {
  resumen: (
    <S>
      <rect x="3" y="5" width="10" height="14" rx="2" transform="rotate(-10 8 12)" />
      <rect x="11" y="5" width="10" height="14" rx="2" transform="rotate(10 16 12)" />
    </S>
  ),
  agentes: (
    <S>
      <rect x="6" y="3" width="12" height="16" rx="2" />
      <path d="M9 21h9a2 2 0 0 0 2-2V8" />
      <Glifo x={12} y={14} size={8} c="♠" />
    </S>
  ),
  movimientos: (
    <S>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="6" strokeDasharray="2 2.2" />
      <path d="M10 14V9m0 0-1.6 1.6M10 9l1.6 1.6M14 10v5m0 0-1.6-1.6M14 15l1.6-1.6" />
    </S>
  ),
  cierres: (
    <S>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2M9 3h6" />
    </S>
  ),
  jugadoresBancados: (
    <S>
      <ellipse cx="12" cy="7" rx="7" ry="3" />
      <path d="M5 7v4c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 11v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4" />
    </S>
  ),
  usuarios: (
    <S>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M18 12v3M21 12v2" />
    </S>
  ),
  wallet: (
    <S>
      <path d="M9 3h6l-1.5 3h-3zM7.5 8.5C5 11 4 13 4 15.5 4 18.5 7 21 12 21s8-2.5 8-5.5c0-2.5-1-4.5-3.5-7z" />
      <Glifo x={12} y={17} size={8} c="$" />
    </S>
  ),
  garantias: (
    <S>
      <path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" />
      <Glifo x={12} y={15} size={9} c="♠" />
    </S>
  ),
  proveedores: (
    <S>
      <path d="M3 8l9-5 9 5v8l-9 5-9-5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </S>
  ),
  supervisores: (
    <S>
      <path d="M4 17l-1-9 5 4 4-7 4 7 5-4-1 9zM5 21h14" />
    </S>
  ),
  cuenta: (
    <S>
      <rect x="5" y="3" width="14" height="18" rx="2.5" />
      <Glifo x={12} y={13} size={9} c="A" />
      <Glifo x={12} y={19} size={6} c="♠" />
    </S>
  ),
  cuentasSocios: (
    <S>
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
    </S>
  ),
  comisionesReferidos: (
    <S>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-6 6" />
      <circle cx="9.3" cy="9.3" r="1" />
      <circle cx="14.7" cy="14.7" r="1" />
    </S>
  ),
  resumenClub: (
    <S>
      <path d="M5 20V12M12 20V5M19 20V9M3 20h18" />
    </S>
  ),
  rodeo: (
    <S>
      <path d="M6 20V12a6 6 0 0 1 12 0v8h-4v-8a2 2 0 0 0-4 0v8z" />
    </S>
  ),
  resumenAgentes: (
    <S>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </S>
  ),
  resumenFinanciero: (
    <S>
      <circle cx="12" cy="12" r="9" />
      <path d="M7 14l3-3 2 2 4-5" />
    </S>
  ),
};
