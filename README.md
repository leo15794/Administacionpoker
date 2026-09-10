# DigiPlayers — sistema de gestión de agentes de póker (v1 / prototipo funcional)

Reemplaza, en su primera versión, el motor de cierre y saldos de la planilla "DIGIPLAYERS
MANAGER" (Google Sheets) por un backend transaccional + un panel admin + un portal de
agentes. **No se modificó ni se escribió nada en la planilla original** — todo lo que hay
acá es una copia normalizada de los datos, obtenida solo por lectura.

## Qué incluye esta v1

- **Backend** (`/src`): API en Node/TypeScript + Express + PostgreSQL (driver `pg`, sin ORM
  con binarios nativos para evitar problemas de red/CI). Implementa:
  - Ledger de movimientos **idempotente y atómico** (la causa raíz #1 de los 68 incidentes
    documentados en la bitácora de la planilla).
  - Motor de cierre semanal con reglas versionadas, incluida la regla crítica de Manzur
    (resultado + 75% del rake) y la regla de Cajero UY (deuda a crédito) — **validadas con
    los números reales documentados en la bitácora** (ver `src/engine/__test__.ts`).
  - Saldos por agente/club como vista calculada (nunca editable a mano).
  - Auth simple con roles ADMIN / AGENT.
- **Frontend** (`/web`): panel admin (resumen ejecutivo, agentes y sus deals, cierres
  semanales) + portal de agente (cada agente ve solo su propia cuenta — reemplaza las 13
  planillas externas).
- **Datos reales de seed** (`src/seed.ts`): catálogo de clubes y agentes, saldos vigentes por
  agente/club y el cierre semanal real del 10/08 al 16/08/2026, tomados de la planilla
  maestra. Los % de rakeback/rebate que no estaban documentados por agente puntual se
  completaron con el valor típico del club (marcado como "default" — hay que refinarlo con
  la configuración real cuando esté disponible).

## Cómo correrlo localmente

Requisitos: Node 20+, PostgreSQL 14+.

```bash
# 1) Backend
npm install
cp .env.example .env   # ajustar DATABASE_URL si hace falta
npm run migrate        # crea las tablas
npm run seed           # carga los datos reales
npm run test:cierre    # valida el motor de cierre contra los casos reales de la bitácora
npm run dev            # API en http://localhost:4000

# 2) Frontend (en otra terminal)
cd web
npm install
npm run dev             # http://localhost:5173
```

Para crear el primer usuario de login (admin o agente):

```bash
curl -X POST http://localhost:4000/auth/bootstrap-user \
  -H "Content-Type: application/json" \
  -d '{"agentName":"Prodigio","email":"prodigio@digiplayers.test","password":"unaClaveSegura","role":"AGENT"}'
```

## Producción

Corre en **Vercel** (backend serverless en `api/index.ts` + frontend `/web` como build de
Vite aparte) contra **Neon** (Postgres administrado). No se usa Docker en ningún entorno —
ni en producción ni para pruebas locales.

## Qué falta

1. Cambiar `JWT_SECRET` y las credenciales de Postgres locales de `.env.example` (las de
   producción ya están seteadas en Vercel/Neon, esto es solo para desarrollo local).

## Estructura

```
src/
  db/          schema.sql + conexión a Postgres
  engine/      motor de cierre semanal (puro, testeado)
  repo/        capa de acceso a datos (ledger, cierres, catálogo)
  routes/      endpoints Express
  seed.ts      datos reales de la planilla
web/
  src/pages/   Login, Resumen, Agentes, Cierres, MiCuenta
```
