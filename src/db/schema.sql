-- DigiPlayers — esquema de base de datos
-- Principio: LedgerMovement es la unica fuente de verdad. balances y weekly_closings
-- son proyecciones calculadas a partir del ledger, nunca se editan a mano.

CREATE TABLE IF NOT EXISTS clubs (
  id           TEXT PRIMARY KEY,
  name         TEXT UNIQUE NOT NULL,
  unit         TEXT NOT NULL DEFAULT 'USD',        -- USD, USDT, FICHAS
  current_rate NUMERIC(18,6) NOT NULL DEFAULT 1,   -- tasa vigente unidad->USD
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id             TEXT PRIMARY KEY,
  name           TEXT UNIQUE NOT NULL,
  external_id    TEXT UNIQUE,
  supervisor     TEXT,
  default_system TEXT NOT NULL DEFAULT 'WIN_LOSE' CHECK (default_system IN ('PREPAGO','WIN_LOSE')),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  person_key     TEXT,                              -- agrupa logins de la misma persona (caso Juan, BIT-008)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Configuracion comercial agente<->club. NUNCA es un permiso de acceso (BIT-050):
-- cualquier agente puede operar en cualquier club activo. Solo define % y sistema, versionado.
CREATE TABLE IF NOT EXISTS agent_club_deals (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL REFERENCES agents(id),
  club_id       TEXT NOT NULL REFERENCES clubs(id),
  system        TEXT NOT NULL CHECK (system IN ('PREPAGO','WIN_LOSE')),
  rakeback_pct  NUMERIC(6,4) NOT NULL DEFAULT 0,
  rebate_pct    NUMERIC(6,4) NOT NULL DEFAULT 0,
  valid_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to      TIMESTAMPTZ,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_deals_agent_club ON agent_club_deals(agent_id, club_id, valid_from);

-- Reglas especiales fuera de la formula generica (ej. Manzur = resultado + 75% del rake).
-- Versionadas por vigencia -> un cierre viejo siempre se recalcula con la regla que tenia en ese momento.
CREATE TABLE IF NOT EXISTS rule_versions (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  club_id     TEXT REFERENCES clubs(id),
  rule_key    TEXT NOT NULL,          -- ej "MANZUR_75_RAKE", "CAJERO_CREDITO"
  params      JSONB NOT NULL DEFAULT '{}',
  valid_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to    TIMESTAMPTZ,
  description TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rules_agent_key ON rule_versions(agent_id, rule_key, valid_from);

CREATE TABLE IF NOT EXISTS players (
  id           TEXT PRIMARY KEY,
  external_id  TEXT NOT NULL,          -- ID estable del proveedor, nunca el nombre (BIT-047)
  display_name TEXT,
  club_id      TEXT NOT NULL REFERENCES clubs(id),
  agent_id     TEXT REFERENCES agents(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(club_id, external_id)
);

-- Override manual jugador->agente (BIT-069): IDs que siempre deben mapear al mismo
-- agente aunque el reporte del club venga sin agente asignado.
CREATE TABLE IF NOT EXISTS player_agent_overrides (
  id                  TEXT PRIMARY KEY,
  player_external_id  TEXT NOT NULL,
  club_id             TEXT REFERENCES clubs(id),
  agent_id            TEXT NOT NULL REFERENCES agents(id),
  reason              TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(player_external_id, club_id)
);

-- ============ LEDGER: fuente unica de verdad ============
CREATE TABLE IF NOT EXISTS ledger_movements (
  id               TEXT PRIMARY KEY,
  idempotency_key  TEXT UNIQUE NOT NULL,   -- nunca se aplica dos veces el mismo movimiento (BIT-001/014/016/047)
  type             TEXT NOT NULL CHECK (type IN ('CARGA','DESCARGA','COBRO','PAGO','TRANSFERENCIA_ENTRE_CLUBES','TICKET_PROMOCIONAL','AJUSTE','CIERRE_SEMANAL')),
  club_id          TEXT NOT NULL REFERENCES clubs(id),
  club_destino_id  TEXT REFERENCES clubs(id),   -- para TRANSFERENCIA_ENTRE_CLUBES
  agent_id         TEXT NOT NULL REFERENCES agents(id),
  amount           NUMERIC(18,4) NOT NULL,       -- en moneda contable (USD)
  original_amount  NUMERIC(18,4),                -- en unidad de origen (fichas), si aplica
  original_unit    TEXT,
  payment_method   TEXT NOT NULL DEFAULT 'SIN_TESORERIA' CHECK (payment_method IN ('USDT','EFECTIVO','ZELLE','SIN_TESORERIA','OTRO')),
  status           TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (status IN ('PENDIENTE','APLICADO','REVERTIDO')),
  occurred_at      TIMESTAMPTZ NOT NULL,
  registered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  observation      TEXT,
  refs             TEXT[] NOT NULL DEFAULT '{}',
  created_by       TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_agent_club ON ledger_movements(agent_id, club_id);
CREATE INDEX IF NOT EXISTS idx_ledger_type_status ON ledger_movements(type, status);

-- Proyeccion de tesoreria real. Un movimiento con payment_method USDT o EFECTIVO genera
-- EXACTAMENTE una entrada aca (BIT-043/051/052). SIN_TESORERIA no genera ninguna.
CREATE TABLE IF NOT EXISTS treasury_entries (
  id          TEXT PRIMARY KEY,
  movement_id TEXT UNIQUE NOT NULL REFERENCES ledger_movements(id),
  ledger      TEXT NOT NULL CHECK (ledger IN ('WALLET_MANOS','CAJA_EFECTIVO')),
  direction   TEXT NOT NULL CHECK (direction IN ('INGRESO','EGRESO')),
  amount      NUMERIC(18,4) NOT NULL,
  custodian   TEXT,                       -- obligatorio si ledger = CAJA_EFECTIVO
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ajuste manual de tesoreria: plata que entra o sale de la wallet/caja SIN venir de un
-- movimiento de agente (aporte propio, retiro de socio, diferencia de arqueo, etc).
-- Deliberadamente separado de treasury_entries/ledger_movements: no toca balances de
-- agentes y siempre queda identificado como ajuste manual en el historial, nunca mezclado
-- con la proyección automática.
CREATE TABLE IF NOT EXISTS treasury_adjustments (
  id          TEXT PRIMARY KEY,
  ledger      TEXT NOT NULL CHECK (ledger IN ('WALLET_MANOS','CAJA_EFECTIVO')),
  direction   TEXT NOT NULL CHECK (direction IN ('INGRESO','EGRESO')),
  amount      NUMERIC(18,4) NOT NULL,
  custodian   TEXT,                       -- obligatorio si ledger = CAJA_EFECTIVO
  reason      TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT
);

-- Vista materializada de saldo por agente y club. Se recalcula desde ledger_movements,
-- nunca se edita a mano (elimina la clase de bug de BIT-002/013/029).
CREATE TABLE IF NOT EXISTS balances (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(id),
  club_id    TEXT NOT NULL REFERENCES clubs(id),
  amount     NUMERIC(18,4) NOT NULL DEFAULT 0,   -- positivo = a favor del agente, negativo = a favor nuestro
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, club_id)
);

-- Garantia de un agente. Separada del saldo operativo: nunca comparten clave (BIT-034).
-- Solo puede haber UNA fila activa por agente a la vez — se actualiza in-place (nunca se
-- inserta una fila activa nueva sin antes desactivar la anterior), así el total agregado
-- del Resumen no cuenta la misma garantía dos veces.
CREATE TABLE IF NOT EXISTS guarantees (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(id),
  amount     NUMERIC(18,4) NOT NULL DEFAULT 0,
  consumed   NUMERIC(18,4) NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  notes      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historial de cada alta/aumento/reducción/consumo/baja de garantía, para que la pestaña
-- de Garantías pueda mostrar "qué pasó" y no solo el número final.
CREATE TABLE IF NOT EXISTS guarantee_movements (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES agents(id),
  guarantee_id        TEXT NOT NULL REFERENCES guarantees(id),
  type                TEXT NOT NULL CHECK (type IN ('ALTA','AUMENTO','REDUCCION','CONSUMO','BAJA')),
  amount              NUMERIC(18,4) NOT NULL,
  resulting_amount    NUMERIC(18,4) NOT NULL,
  resulting_consumed  NUMERIC(18,4) NOT NULL,
  notes               TEXT,
  created_by          TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cierre semanal por agente+club. Guarda snapshot de las reglas usadas.
CREATE TABLE IF NOT EXISTS weekly_closings (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES agents(id),
  club_id         TEXT NOT NULL REFERENCES clubs(id),
  week_start      DATE NOT NULL,
  week_end        DATE NOT NULL,
  system          TEXT NOT NULL CHECK (system IN ('PREPAGO','WIN_LOSE')),
  result          NUMERIC(18,4) NOT NULL DEFAULT 0,
  rake_total      NUMERIC(18,4) NOT NULL DEFAULT 0,
  rakeback_pct    NUMERIC(6,4) NOT NULL DEFAULT 0,
  rakeback        NUMERIC(18,4) NOT NULL DEFAULT 0,
  rebate_pct      NUMERIC(6,4) NOT NULL DEFAULT 0,
  rebate          NUMERIC(18,4) NOT NULL DEFAULT 0,
  adjusted_result NUMERIC(18,4) NOT NULL DEFAULT 0,
  final_closing   NUMERIC(18,4) NOT NULL DEFAULT 0,
  rate_snapshot   NUMERIC(18,6) NOT NULL DEFAULT 1,
  rule_applied    TEXT,
  status          TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (status IN ('BORRADOR','APLICADO','CORREGIDO')),
  observation     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, club_id, week_start)   -- clave idempotente del cierre (BIT-001)
);

-- Snapshot fechado de auditoria: reemplaza a CONTROL_SISTEMA (nunca "OK" hardcodeado, BIT-003/013/039).
CREATE TABLE IF NOT EXISTS audit_snapshots (
  id        TEXT PRIMARY KEY,
  taken_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  scope     TEXT NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('OK','DIFERENCIA','ERROR')),
  details   JSONB NOT NULL DEFAULT '{}'
);

-- Usuarios del portal (login). Un agent puede tener mas de un usuario (caso Juan, BIT-008).
CREATE TABLE IF NOT EXISTS agent_users (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL REFERENCES agents(id),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'AGENT' CHECK (role IN ('AGENT','ADMIN')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Columna agregada después del primer despliegue: en una base ya existente, CREATE TABLE
-- IF NOT EXISTS no la crea, así que se agrega acá de forma idempotente.
ALTER TABLE agent_users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
