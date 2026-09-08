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

Requisitos: Node 20+, PostgreSQL 14+ (o Docker).

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

## Con Docker

```bash
docker compose up --build
# API:      http://localhost:4000
# Frontend: http://localhost:8080
```

(La migración y el seed no corren solos dentro del contenedor todavía — ejecutar
`npm run migrate && npm run seed` apuntando a `DATABASE_URL` del compose, o agregar un
job de init si se quiere 100% automático.)

## Qué falta para producción

1. **Elegir hosting.** Este repo ya viene con Dockerfiles listos para Railway, Render,
   Fly.io o cualquier VPS. Si preferís Vercel para el frontend, se puede desplegar `/web`
   directo (es una SPA de Vite) y dejar el backend + Postgres en Railway/Render/Fly.
2. Cambiar `JWT_SECRET` y las credenciales de Postgres.
3. Sumar HTTPS (lo resuelve el proveedor de hosting en la mayoría de los casos).
4. Reemplazar el bootstrap manual de usuarios por un flujo de alta de agentes desde el
   panel admin.
5. Migrar el histórico completo de movimientos (hoy la v1 arranca desde el estado actual
   real, no reconstruye mes a mes las 13 cuentas — ver el análisis para el detalle).

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

## Deploy en Vercel (GitHub + Neon)

Este repo ya está preparado para desplegarse como DOS proyectos separados de Vercel
desde el mismo repositorio de GitHub:

1. **Backend** (root del repo): usa `api/index.ts` como función serverless (reexporta
   la misma app de Express de `src/app.ts`) y `vercel.json` para que todas las rutas
   (`/auth/...`, `/dashboard/...`, `/portal/...`, `/movements/...`) lleguen ahí.
2. **Frontend** (`/web`): sitio estático de Vite.

### Pasos

1. Subí este repo a GitHub (si no lo hiciste ya):
   ```
   git init
   git add .
   git commit -m "DigiPlayers v1"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/digiplayers.git
   git push -u origin main
   ```
2. En Vercel → **Add New… → Project** → importá el repo. Dejá el **Root Directory**
   en blanco (raíz del repo) → esto crea el proyecto del **backend**.
3. Antes de deployar, andá a la pestaña **Storage** del proyecto → **Create Database**
   → elegí **Neon** (Postgres) → conectala al proyecto. Vercel te crea sola la
   variable de entorno `DATABASE_URL`.
4. Agregá también la variable de entorno `JWT_SECRET` (cualquier texto largo random).
5. Deploy. Cuando termine, copiá la URL que te da (ej. `https://digiplayers.vercel.app`).
6. Importá el repo **otra vez** como un segundo proyecto en Vercel, pero esta vez poné
   **Root Directory = `web`** → esto crea el proyecto del **frontend**.
7. En ese segundo proyecto, agregá la variable de entorno `VITE_API_URL` con la URL
   del backend del paso 5 (sin barra al final).
8. Deploy. Listo — esa es la URL que vas a usar para entrar día a día.
9. Una sola vez, hay que crear las tablas y cargar los datos reales en la base de Neon
   (`migrate` + `seed`). Pasame el `DATABASE_URL` de Neon (Storage → tu base →
   `.env.local` o "Connection string") y lo corro yo mismo contra tu base, no hace
   falta que lo hagas por terminal.
