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

-- Configuración por defecto del club (pantalla "Configuración → Clubes" pedida
-- explícitamente): un deal agente↔club que no especifica su propio % hereda esto. El
-- rebate tiene destino configurable porque no todos los clubes lo liquidan igual (algunos
-- lo suman al saldo operativo del agente, otros lo acumulan al rakeback pendiente de un
-- supervisor — ver agent_club_deals.rebate_destino más abajo).
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS default_rakeback_pct NUMERIC(6,4) NOT NULL DEFAULT 0;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS default_rebate_pct NUMERIC(6,4) NOT NULL DEFAULT 0;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS rebate_destino TEXT NOT NULL DEFAULT 'SALDO_OPERATIVO';
ALTER TABLE clubs DROP CONSTRAINT IF EXISTS clubs_rebate_destino_check;
ALTER TABLE clubs ADD CONSTRAINT clubs_rebate_destino_check CHECK (rebate_destino IN ('SALDO_OPERATIVO','RAKEBACK_SUPERVISOR'));
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS fee_pct NUMERIC(6,4) NOT NULL DEFAULT 0;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS platform_pct NUMERIC(6,4) NOT NULL DEFAULT 0;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS union_pct NUMERIC(6,4) NOT NULL DEFAULT 0;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS import_source TEXT;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS notes TEXT;
-- Plataforma/red de origen para el importador de cierres (ej. "SUPREMA") — un mismo club real
-- (ej. "Fénix") puede operar en más de una red (Suprema, GG), y cada una es un registro de
-- club separado porque los cierres se liquidan por separado. Sin esto, el selector de club del
-- importador mostraría TODOS los clubes activos mezclados, incluyendo los de otras plataformas
-- que no tiene sentido elegir ahí (ej. "Fénix GG" al importar un archivo de SupremaPoker).
-- NULL = club sin importador de archivo asociado (se sigue cargando el cierre a mano).
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS import_platform TEXT;

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

-- Tipo de cuenta (punto 4 del documento de rediseño): catálogo CERRADO, nunca texto libre.
-- Distinto de default_system (que sigue siendo el motor de cálculo de cierre semanal, y solo
-- aplica cuando el tipo de cuenta es PREPAGO o WIN_LOSE). Los otros tipos (bancado, interno,
-- supervisor, unión) tienen su propio modelo, todavía por construir — esto solo deja
-- clasificada la cuenta desde ya para no tener que migrar de nuevo cuando se construyan.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'WIN_LOSE';
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_account_type_check;
ALTER TABLE agents ADD CONSTRAINT agents_account_type_check
  CHECK (account_type IN ('PREPAGO','WIN_LOSE','BANCADO','INTERNO','SUPERVISOR','UNION'));

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

-- Clave idempotente opcional (solo la usan las importaciones masivas, ej. el historial real
-- de Wallet Manos) — permite re-correr un import sin duplicar filas. Los ajustes manuales
-- cargados a mano desde la pestaña de Wallet/Tesorería no la usan (quedan en NULL).
ALTER TABLE treasury_adjustments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS treasury_adjustments_idempotency_key_idx
  ON treasury_adjustments (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Ledger inmutable (regla BIT-nueva, pedida explícitamente): nunca se borra un ajuste de
-- tesorería. Si está mal, se revierte con un ajuste opuesto y este queda marcado como
-- REVERTIDO — el ajuste original nunca desaparece, para poder reconstruir qué pasó.
ALTER TABLE treasury_adjustments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'APLICADO';
ALTER TABLE treasury_adjustments DROP CONSTRAINT IF EXISTS treasury_adjustments_status_check;
ALTER TABLE treasury_adjustments ADD CONSTRAINT treasury_adjustments_status_check CHECK (status IN ('APLICADO','REVERTIDO'));
ALTER TABLE treasury_adjustments ADD COLUMN IF NOT EXISTS reverted_by_id TEXT;

-- Mismo principio para weekly_closings: la restricción de status ya definida en la tabla
-- puede quedar vieja en bases existentes (CREATE TABLE IF NOT EXISTS no las actualiza), así
-- que se repite acá para que también acepten 'REVERTIDO'.
ALTER TABLE weekly_closings DROP CONSTRAINT IF EXISTS weekly_closings_status_check;
ALTER TABLE weekly_closings ADD CONSTRAINT weekly_closings_status_check CHECK (status IN ('BORRADOR','APLICADO','CORREGIDO','REVERTIDO'));

-- Módulo de supervisores (punto 5 del documento de rediseño): cuando el club del deal tiene
-- rebate_destino = RAKEBACK_SUPERVISOR, el % de rebate de ESE cierre no se suma al saldo
-- operativo del agente — se acredita centralizado al agente supervisor (agents.supervisor,
-- resuelto por nombre) como un movimiento de ajuste aparte. Estas columnas dejan grabado en
-- el propio cierre qué pasó (para reconstruir el historial) y qué movimiento hay que revertir
-- si el cierre se revierte.
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS rebate_destino TEXT;
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS supervisor_agent_id TEXT REFERENCES agents(id);
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS supervisor_movement_id TEXT;

-- Módulo de bancados (punto 6 del documento de rediseño, caso real Matías Fontal): la "memoria"
-- es la deuda que el bancado arrastra con nosotros cuando el rakeback de una semana no alcanza
-- para cubrir su pérdida en mesa. Nunca prescribe (deuda eterna): baja sola cuando una semana
-- futura del bancado (su % de mesa + su rakeback) alcanza para cubrirla. Una sola fila activa
-- por agente+club porque un bancado puede operar varios clubes con cajas independientes.
CREATE TABLE IF NOT EXISTS bancado_debts (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(id),
  club_id    TEXT NOT NULL REFERENCES clubs(id),
  debt       NUMERIC(18,4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, club_id)
);

-- Snapshot de estas cifras en el propio cierre, para poder ver el detalle en el historial y
-- para poder restaurar la memoria exacta si el cierre se revierte (LEDGER INMUTABLE también acá).
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS bancado_digiplayers_share NUMERIC(18,4);
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS bancado_debt_before NUMERIC(18,4);
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS bancado_debt_after NUMERIC(18,4);

-- "Rodeo" (pedido explícito del usuario, solo aplica a SupremaPoker: Fénix, TeamBack). Reglas
-- verbatim del usuario: si un jugador pierde esa semana genera rodeo positivo (a favor); si
-- gana, genera "memoria" negativa que se acumula y solo se compensa cuando ESE MISMO jugador
-- vuelva a perder en el futuro (deuda eterna, igual que bancados) — nunca se mezcla con la
-- cuenta corriente operativa del agente (fichas/cargas/descargas/saldo). Del rodeo ya neto de
-- memoria se reparte: sin agente 30% App + 35% Unión + 35% Club; con agente 30% App + 35%
-- Unión + 20% Club + 15% Agente. App/Unión son terceros, no se registran acá. El share de
-- Club es informativo (nunca se acredita a nadie, como bancado_digiplayers_share). El share
-- de Agente SÍ es plata real y se suma directo al cierre final de ese agente.
CREATE TABLE IF NOT EXISTS rodeo_player_memory (
  id                  TEXT PRIMARY KEY,
  player_external_id  TEXT NOT NULL,
  club_id             TEXT NOT NULL REFERENCES clubs(id),
  memory              NUMERIC(18,4) NOT NULL DEFAULT 0,   -- deuda pendiente, siempre >= 0
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(player_external_id, club_id)
);
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS rodeo NUMERIC(18,4) NOT NULL DEFAULT 0;
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS rodeo_club_share NUMERIC(18,4) NOT NULL DEFAULT 0;
-- Snapshot (memoriaAnterior/memoriaNueva del agente + desglose informativo por jugador) para
-- poder restaurar la memoria exacta si este cierre se revierte (mismo principio que
-- bancado_debt_before/after).
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS rodeo_detalle JSONB;

-- CORRECCIÓN (auditoría vs. planilla real, hoja MEMORIA_RODEO, BIT-nueva): la memoria de rodeo
-- es por AGENTE+CLUB, no por jugador — la planilla agrega el rodeo bruto de todos los jugadores
-- de un agente antes de netear contra la memoria arrastrada, así un jugador que gana esa semana
-- se compensa contra lo que generan los OTROS jugadores del mismo agente, no queda aislado. La
-- tabla rodeo_player_memory NO se borra (queda como historial), pero deja de usarse: la memoria
-- vigente vive acá desde ahora.
CREATE TABLE IF NOT EXISTS rodeo_agent_memory (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  club_id     TEXT NOT NULL REFERENCES clubs(id),
  memory      NUMERIC(18,4) NOT NULL DEFAULT 0,   -- deuda pendiente del agente, siempre >= 0
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, club_id)
);
-- Migración única de consolidación: suma la memoria vieja de rodeo_player_memory por agente,
-- usando el agente al que está asignado HOY cada jugador en ese club (decisión explícita del
-- usuario: no se pierde deuda/crédito pendiente al pasar a memoria por agente). El
-- ON CONFLICT DO NOTHING hace que esto corra una sola vez de verdad — si se vuelve a correr la
-- migración después, la fila ya existe y no se vuelve a sumar.
INSERT INTO rodeo_agent_memory (id, agent_id, club_id, memory)
SELECT 'rodeoagentmem_migrado_' || p.agent_id || '_' || p.club_id,
       p.agent_id, p.club_id, SUM(rpm.memory)
FROM rodeo_player_memory rpm
JOIN players p ON p.external_id = rpm.player_external_id AND p.club_id = rpm.club_id
WHERE p.agent_id IS NOT NULL
GROUP BY p.agent_id, p.club_id
ON CONFLICT (agent_id, club_id) DO NOTHING;

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
  status          TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (status IN ('BORRADOR','APLICADO','CORREGIDO','REVERTIDO')),
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

-- BIT-nueva: el UNIQUE(agent_id, club_id, week_start) original bloqueaba para siempre volver a
-- cerrar la misma semana de un agente+club una vez revertida, porque la fila REVERTIDO nunca se
-- borra (principio de inmutabilidad del ledger) y seguía ocupando la clave. Se reemplaza por un
-- índice único parcial que ignora las filas REVERTIDO: la clave idempotente (BIT-001) sigue
-- vigente para cierres activos, pero un revert abre la puerta a re-cerrar esa semana bien.
ALTER TABLE weekly_closings DROP CONSTRAINT IF EXISTS weekly_closings_agent_id_club_id_week_start_key;
DROP INDEX IF EXISTS weekly_closings_agent_id_club_id_week_start_key;
CREATE UNIQUE INDEX IF NOT EXISTS weekly_closings_agent_club_week_active_key
  ON weekly_closings(agent_id, club_id, week_start)
  WHERE status <> 'REVERTIDO';
