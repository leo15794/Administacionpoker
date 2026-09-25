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

-- "Jugadores bancados" (pedido 14/09/2026): un jugador puntual de un agente que se contabiliza
-- aparte (fuera del sistema, por ahora) en vez de sumarse al cierre normal de ese agente — ver
-- pantalla "Jugadores bancados" y repo/imports.ts. Default false: no cambia nada de lo que ya
-- había cargado hasta ahora. NO confundir con agents.account_type = 'BANCADO' (eso es una
-- cuenta de AGENTE con motor de cierre propio, esto es un JUGADOR individual excluido del
-- agregado de su agente).
ALTER TABLE players ADD COLUMN IF NOT EXISTS bancado BOOLEAN NOT NULL DEFAULT false;

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

-- Desglose por tipo de juego (solo SupremaPoker: Fenix/TeamBack Suprema) — igual a las
-- columnas "Ring Game"/"MTT"/"SNG" del resumen semanal por club (ver repo/clubResumen.ts).
-- NULL en cierres viejos o de otras plataformas (GG/Fenix GG/Tiny/X-Poker no tienen este
-- desglose). ring_game + mtt + sng = rake_total siempre que esten cargados.
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS jugadores INTEGER;
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS ring_game NUMERIC(18,4);
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS mtt NUMERIC(18,4);
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS sng NUMERIC(18,4);

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

-- Adelantos de rakeback: plata (fichas o USDT) que se le adelanta a un agente A CUENTA de un
-- rakeback que todavía no se generó. Por AGENTE, no por agente+club (corregido 11/09/2026: un
-- agente puede operar y seguir generando rake en varios clubes a la vez, así que un adelanto no
-- está "atado" al club donde la planilla lo registró — mismo criterio que guarantees). Separado
-- del saldo operativo por la misma razón que guarantees (BIT-034): mientras no se compense
-- contra un cierre real, no es plata que el agente "ganó". CADA FILA ES UN ADELANTO
-- INDEPENDIENTE (corregido 12/09/2026, segunda vuelta): un mismo agente puede tener varias filas
-- activas a la vez — se le pueden dar varios adelantos en la misma semana, en clubes distintos —
-- no existe "el" adelanto de un agente.
CREATE TABLE IF NOT EXISTS rakeback_advances (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL REFERENCES agents(id),
  amount         NUMERIC(18,4) NOT NULL DEFAULT 0,
  consumed       NUMERIC(18,4) NOT NULL DEFAULT 0,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  club_origen_id TEXT REFERENCES clubs(id),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Si la tabla ya existía de una versión anterior (por agente+club), se saca la columna acá —
-- CREATE TABLE IF NOT EXISTS de arriba no la toca en una base que ya la tenía creada.
ALTER TABLE rakeback_advances DROP COLUMN IF EXISTS club_id;
-- club_origen_id (12/09/2026): a pedido del usuario, referencia informativa de en qué club se
-- originó el adelanto (para poder rastrearlo contra la planilla) — a diferencia del club_id que
-- se sacó arriba, este NUNCA se usa para limitar contra qué rake se compensa (eso sigue siendo
-- por agente, en cualquier club). Puede quedar en null si no se sabe/no aplica.
ALTER TABLE rakeback_advances ADD COLUMN IF NOT EXISTS club_origen_id TEXT REFERENCES clubs(id);
-- created_at (12/09/2026, segunda vuelta): para poder ordenar/mostrar varios adelantos del mismo
-- agente en el orden en que se cargaron — las filas existentes de antes de esta migración no
-- tenían este dato, se backfillea con su updated_at (mejor aproximación disponible).
ALTER TABLE rakeback_advances ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
UPDATE rakeback_advances SET created_at = updated_at WHERE created_at IS NULL;
ALTER TABLE rakeback_advances ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE rakeback_advances ALTER COLUMN created_at SET NOT NULL;
-- medio (22/09/2026, pedido de Leo): un adelanto en FICHAS mueve el stock físico del agente
-- YA en el Alta (movimiento CARGA, ver repo/advances.ts) -- se descuenta después en la
-- liquidación real (Leo: "es un adelanto de sueldo y después se descuenta"). Un adelanto en
-- USDT sale de la wallet YA en el Alta (movimiento ADELANTO_RAKEBACK, con su entrada de
-- tesorería -- Leo: "los adelantos de usdt tienen que afectar a la wallet porque salen de
-- ahí"). NULL = adelanto viejo (de antes de este cambio), no mueve nada, se comporta como
-- siempre. club_origen_id pasa a ser obligatorio a nivel aplicación (no acá en la DB, para no
-- romper filas viejas) cuando medio no es NULL, porque ahí sí hace falta saber de qué club sale
-- la plata/fichas.
ALTER TABLE rakeback_advances ADD COLUMN IF NOT EXISTS medio TEXT CHECK (medio IN ('FICHAS','USDT'));

-- Historial de cada alta/aumento/reducción/consumo/baja/corrección de adelanto, mismo criterio
-- que guarantee_movements. CORRECCION (12/09/2026): para arreglar un error de carga (monto mal
-- tipeado, etc.) dejando explícito en el historial que no fue un evento real de negocio, a
-- diferencia de AUMENTO/REDUCCION.
-- Cargas de tesoreria "pendientes de cruzar" (21/09/2026, pedido de Leo): un movimiento tipo
-- CARGA (Cargar Movimiento) ademas de sumar al balance del agente y proyectar en tesoreria como
-- siempre, abre aca una "nota de credito" contra ese agente+club -- mismo mecanismo que
-- rakeback_advances (amount/consumed/active), pero por agente+club (no solo por agente, a
-- diferencia de los adelantos) y con origen fijo en UN movimiento puntual (1 a 1), para poder
-- cruzarla despues en Liquidaciones contra el rakeback que se le paga -- exactamente igual que
-- ya se hace con los adelantos de rakeback.
CREATE TABLE IF NOT EXISTS carga_pendientes_cruce (
  id          TEXT PRIMARY KEY,
  movement_id TEXT UNIQUE NOT NULL REFERENCES ledger_movements(id),
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  club_id     TEXT NOT NULL REFERENCES clubs(id),
  amount      NUMERIC(18,4) NOT NULL,
  consumed    NUMERIC(18,4) NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historial de consumos de cada carga pendiente -- mismo criterio que rakeback_advance_movements.
-- La ALTA se crea sola al registrar el movimiento CARGA (ver repo/ledger.ts); CONSUMO se agrega
-- al cruzarla en Liquidaciones (ver repo/cargaCruces.ts).
CREATE TABLE IF NOT EXISTS carga_cruce_movements (
  id                  TEXT PRIMARY KEY,
  carga_id            TEXT NOT NULL REFERENCES carga_pendientes_cruce(id),
  agent_id            TEXT NOT NULL REFERENCES agents(id),
  type                TEXT NOT NULL CHECK (type IN ('ALTA','CONSUMO')),
  amount              NUMERIC(18,4) NOT NULL,
  resulting_amount    NUMERIC(18,4) NOT NULL,
  resulting_consumed  NUMERIC(18,4) NOT NULL,
  notes               TEXT,
  created_by          TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rakeback pendiente (22/09/2026, pedido de Leo): el cierre semanal separa el resultado de
-- mesas (Win/Lose -- lo único que mueve el stock físico/balance del agente automáticamente) de
-- todo lo demás (rakeback, rebate, Rodeo, ajuste manual), que queda ACÁ como "pendiente de
-- pago" hasta decidir cómo se salda: en fichas (mueve stock, movimiento CARGA), en USDT/efectivo
-- (pago financiero real, movimiento PAGO, no toca stock) o dejarlo así. Un cierre normal genera
-- UNA fila (role=AGENTE); si el club desvía el rebate a un supervisor (rebate_destino =
-- RAKEBACK_SUPERVISOR), genera una SEGUNDA fila (role=SUPERVISOR) por ese rebate, a nombre del
-- supervisor -- antes se acreditaba directo a su balance, ahora también queda pendiente.
CREATE TABLE IF NOT EXISTS rakeback_pendiente (
  id                TEXT PRIMARY KEY,
  weekly_closing_id TEXT NOT NULL REFERENCES weekly_closings(id),
  role              TEXT NOT NULL DEFAULT 'AGENTE' CHECK (role IN ('AGENTE','SUPERVISOR')),
  agent_id          TEXT NOT NULL REFERENCES agents(id),
  club_id           TEXT NOT NULL REFERENCES clubs(id),
  amount            NUMERIC(18,4) NOT NULL,
  consumed          NUMERIC(18,4) NOT NULL DEFAULT 0,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (weekly_closing_id, role)
);

-- Pago de rakeback pendiente en USDT/efectivo/Zelle (22/09/2026): es un pago financiero real
-- (genera su entrada de tesorería, igual que un PAGO común) pero NUNCA debe tocar el stock/
-- balance del agente -- ese es todo el punto de separar el rakeback pendiente del stock físico.
-- Tipo de movimiento propio (en vez de reusar 'PAGO', que SIEMPRE resta del balance -- ver
-- deltaParaBalance en repo/ledger.ts) para que quede sin ambigüedad en el ledger, y para que
-- Revertir/Eliminar funcionen solos sin casos especiales (deltaParaBalance le da delta 0).
ALTER TABLE ledger_movements DROP CONSTRAINT IF EXISTS ledger_movements_type_check;
ALTER TABLE ledger_movements ADD CONSTRAINT ledger_movements_type_check
  CHECK (type IN ('CARGA','DESCARGA','COBRO','PAGO','TRANSFERENCIA_ENTRE_CLUBES','TICKET_PROMOCIONAL','AJUSTE','CIERRE_SEMANAL','PAGO_RAKEBACK','ADELANTO_RAKEBACK'));

-- Historial de esta rakeback pendiente -- mismo patrón que carga_cruce_movements/
-- rakeback_advance_movements. ALTA se crea sola al aplicar el cierre (ver repo/closings.ts);
-- PAGO_FICHAS/PAGO_USDT se generan al pagarla (ver repo/rakebackPendiente.ts), cada uno con su
-- propio movement_id de ledger_movements para poder rastrear el pago real; BAJA cuando se
-- revierte/borra el cierre que la originó.
CREATE TABLE IF NOT EXISTS rakeback_pendiente_movements (
  id                  TEXT PRIMARY KEY,
  pendiente_id        TEXT NOT NULL REFERENCES rakeback_pendiente(id),
  agent_id            TEXT NOT NULL REFERENCES agents(id),
  type                TEXT NOT NULL CHECK (type IN ('ALTA','PAGO_FICHAS','PAGO_USDT','BAJA')),
  amount              NUMERIC(18,4) NOT NULL,
  resulting_amount    NUMERIC(18,4) NOT NULL,
  resulting_consumed  NUMERIC(18,4) NOT NULL,
  movement_id         TEXT REFERENCES ledger_movements(id),
  notes               TEXT,
  created_by          TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rakeback_advance_movements (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES agents(id),
  advance_id          TEXT NOT NULL REFERENCES rakeback_advances(id),
  type                TEXT NOT NULL CHECK (type IN ('ALTA','AUMENTO','REDUCCION','CONSUMO','BAJA','CORRECCION')),
  amount              NUMERIC(18,4) NOT NULL,
  resulting_amount    NUMERIC(18,4) NOT NULL,
  resulting_consumed  NUMERIC(18,4) NOT NULL,
  notes               TEXT,
  created_by          TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE rakeback_advance_movements DROP COLUMN IF EXISTS club_id;
-- movement_id (22/09/2026): cuando el ALTA/AUMENTO mueve stock o wallet de verdad (medio
-- FICHAS/USDT), acá queda el id del ledger_movements que generó -- mismo criterio que
-- rakeback_pendiente_movements -- para poder deshacerlo si se borra/corrige el adelanto.
ALTER TABLE rakeback_advance_movements ADD COLUMN IF NOT EXISTS movement_id TEXT REFERENCES ledger_movements(id);
-- Si la tabla ya existía de una corrida anterior de la migración, el CHECK de arriba (creado sin
-- 'CORRECCION') no se actualiza solo — se recrea acá para permitirlo también en bases viejas.
ALTER TABLE rakeback_advance_movements DROP CONSTRAINT IF EXISTS rakeback_advance_movements_type_check;
ALTER TABLE rakeback_advance_movements ADD CONSTRAINT rakeback_advance_movements_type_check
  CHECK (type IN ('ALTA','AUMENTO','REDUCCION','CONSUMO','BAJA','CORRECCION'));

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
  role          TEXT NOT NULL DEFAULT 'AGENT' CHECK (role IN ('AGENT','ADMIN','SUPERVISOR')),
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

-- Mismo bug, mismo arreglo, en ledger_movements: el UNIQUE(idempotency_key) original también
-- bloqueaba para siempre volver a generar el movimiento CIERRE_SEMANAL de un agente+club+semana
-- una vez revertido, porque revertirMovimiento nunca borra ni cambia la idempotency_key del
-- movimiento original REVERTIDO — solo le cambia el status (inmutabilidad del ledger). Al
-- reaplicar la semana (ya permitido desde el fix de arriba), el INSERT nuevo usaba la misma
-- clave "cierre:agentId:clubId:weekStart" y chocaba contra la fila vieja REVERTIDO. Se reemplaza
-- por un índice único parcial que ignora las filas REVERTIDO, igual que arriba.
ALTER TABLE ledger_movements DROP CONSTRAINT IF EXISTS ledger_movements_idempotency_key_key;
DROP INDEX IF EXISTS ledger_movements_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_movements_idempotency_key_active_key
  ON ledger_movements(idempotency_key)
  WHERE status <> 'REVERTIDO';

-- ============ CUENTAS DE SOCIOS (equivalente a "Cuentas y memorias" de la planilla) ============
-- A DIFERENCIA de todo lo anterior (ledger de agentes/tesorería, inmutable por diseño), esto es
-- plata de los SOCIOS de la empresa (compensación de Juan, comisión por referido de Uriel,
-- retiros, gastos operativos, etc.) — nada que ver con agentes ni clubes. Pedido explícito del
-- usuario: acá SÍ hay que poder editar y eliminar todo directo, sin la ceremonia de
-- revertir/corregir del resto del sistema — "control 100%".
-- Una "cuenta" es simplemente un nombre (Uriel, Juan, Fede, o cualquier otra que se cree después)
-- con un saldo que es la suma de sus movimientos — igual que una cuenta corriente.
CREATE TABLE IF NOT EXISTS partner_accounts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Movimientos de una cuenta: el monto es libre (+/-), quien carga decide el signo — no hay
-- ALTA/AUMENTO/REDUCCION como en garantías/adelantos, para que editar sea directo (poner el
-- monto correcto y listo). `category` es solo una etiqueta para poder agregar por tipo en los
-- KPIs de "Ganancia neta histórica" (RETIRO y GASTO se restan, AJUSTE se suma) sin tener que
-- adivinar el signo que cada uno le puso al monto.
CREATE TABLE IF NOT EXISTS partner_account_entries (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN ('COMPENSACION','COMISION','PAGO','RETIRO','GASTO','AJUSTE','OTRO')),
  concept    TEXT NOT NULL,
  amount     NUMERIC(18,4) NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_account_entries_account_idx ON partner_account_entries(account_id);

-- ============ STOCK FÍSICO POR CUENTA (equivalente a "Stock por cuenta (fuente)" de la
-- planilla "Stock y deudas consolidados") ============
-- Fichas físicas que tiene cada cuenta (agente) EN CUSTODIA dentro de un club — dato que nadie
-- puede calcular solo, hay que confirmarlo a mano club por club (igual que hoy se hace en la
-- planilla). A diferencia del ledger de agentes (BIT-034, inmutable), esto es un CONTEO físico
-- que se re-confirma y corrige todo el tiempo — a pedido del usuario, se edita/borra directo,
-- sin ceremonia de revertir (mismo criterio que partner_accounts).
-- Una sola fila vigente por agente+club: cargar de nuevo pisa el valor anterior (no se acumula
-- un historial de confirmaciones — si se necesita en el futuro, se agrega aparte).
CREATE TABLE IF NOT EXISTS account_stock (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL REFERENCES agents(id),
  club_id       TEXT NOT NULL REFERENCES clubs(id),
  units         NUMERIC(18,4) NOT NULL DEFAULT 0,
  rate          NUMERIC(18,6),          -- factor de conversión a USD (ej. Tiny ÷31,67 se carga como rate=1/31.67, X-Poker rate=1.2); NULL = todavía sin tasa definida, no se puede convertir a USD
  excluded      BOOLEAN NOT NULL DEFAULT FALSE, -- cuenta "espejo" de otra (ej. superagente que refleja el mismo stack) — se guarda para referencia pero no se suma en los totales, para no duplicar
  estado        TEXT,                    -- etiqueta libre de cómo se confirmó (ej. "Confirmación de usuario", "Auditoría manual", "Movimiento sincronizado")
  fuente        TEXT,                    -- referencia/ticket de auditoría, opcional
  observaciones TEXT,
  confirmado_en DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, club_id)
);
CREATE INDEX IF NOT EXISTS account_stock_club_idx ON account_stock(club_id);

-- ============ RESUMEN SEMANAL POR CLUB ============
-- Reproduce el bloque "RESUMEN DEL CLUB" de la planilla "automatizacion clubes" (una pestaña
-- RESUMEN_TB/RESUMEN_FENIX/RESUMEN_GG/RESUMEN_FENIX_GG por club, confirmadas fórmula por
-- fórmula contra esa planilla el 14/09/2026). Se descubrió que las 5 (TeamBack Suprema, Fénix
-- Suprema, TeamBack GG, Fénix GG, X-Poker) comparten la MISMA forma:
--   Ganancia por rake = SUM(rake_total del cierre semanal * ratio de plataforma) - rakeback pagado
-- Solo cambia el "ratio de plataforma" (lo que la plataforma nos paga a nosotros del rake, antes
-- de pagarle su parte al agente): 80% Suprema, 82,5% TeamBack GG, 90% X-Poker, 65% Fénix GG por
-- defecto (75% para el grupo de Uriel, ver agent_club_deals.club_payout_ratio_override). Tiny GG
-- queda afuera de este cálculo por ahora: su "rebate de plataforma" se reparte proporcional al
-- déficit de TODAS las cuentas de la semana, un dato crudo de importación que hoy no persistimos
-- aparte — ver RESUMEN_TINY de la planilla si hay que retomarlo.
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS weekly_fixed_fee NUMERIC(12,2) NOT NULL DEFAULT 0;
-- platform_pct ya existe (nunca se había usado): fracción del rake que se queda la plataforma.
-- El "ratio de plataforma" de la fórmula de arriba es 1 - platform_pct.

-- Excepción por agente al ratio de plataforma del club (ej. subagentes de Uriel en Fénix GG
-- cobran 75% en vez del 65% general) — NUNCA afecta el saldo del agente ni su cierre individual,
-- solo el cálculo de "Ganancia por rake" en el resumen del club.
ALTER TABLE agent_club_deals ADD COLUMN IF NOT EXISTS club_payout_ratio_override NUMERIC(6,4);

-- "Ganancia Rodeo Club" e "Ingreso por ventas" son datos externos que no salen de ningún cierre
-- de agente (en la planilla se cargan a mano club por semana) — se cargan y corrigen directo,
-- mismo criterio que account_stock (no es un movimiento de plata del ledger de agentes).
CREATE TABLE IF NOT EXISTS club_weekly_extras (
  id                  TEXT PRIMARY KEY,
  club_id             TEXT NOT NULL REFERENCES clubs(id),
  week_start          DATE NOT NULL,
  week_end            DATE NOT NULL,
  ingreso_por_ventas  NUMERIC(18,4) NOT NULL DEFAULT 0,
  observaciones       TEXT,
  created_by          TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(club_id, week_start)
);

-- ============================================================
-- MOTOR DE JUGADORES BANCADOS (15/09/2026)
-- ============================================================
-- Liquidación semanal propia para un jugador marcado como bancado (players.bancado), separada
-- del cierre normal de su agente. Réplica de la lógica ya probada en la planilla Google Sheets
-- (motor "DIGIPLAYERS · MOTOR DE JUGADORES BANCADOS", primera implementación: Matias Fontal,
-- TeamBack Suprema) — mismas reglas, misma fórmula, acá adentro del sistema:
--   - Resultado de mesas positivo: se reparte según % jugador / % banca.
--   - Resultado de mesas negativo: la pérdida completa aumenta el makeup.
--   - El makeup NO se recupera con ganancias de mesas, solo con rakeback.
--   - El rakeback primero cancela el makeup pendiente; el excedente (si el makeup llega a 0)
--     es 100% del jugador.
-- Ver engine/bancados.ts (calcularCierreBancado) para la implementación exacta.

-- Config por jugador bancado — 1:1 con players (solo tiene sentido para un jugador ya marcado
-- bancado, pero no se fuerza acá por FK para poder cargar la config antes de la primera
-- importación que lo traiga). Capital/makeup inicial son el punto de partida cuando todavía no
-- hay ningún cierre de banca cargado (ver bancado_historial para el estado vigente real).
CREATE TABLE IF NOT EXISTS bancado_config (
  player_id            TEXT PRIMARY KEY REFERENCES players(id),
  pct_jugador          NUMERIC(6,4) NOT NULL,
  pct_banca            NUMERIC(6,4) NOT NULL,
  rakeback_pct         NUMERIC(6,4) NOT NULL DEFAULT 0,
  -- Rakeback Banca (18/09/2026): % INDEPENDIENTE del rakeback del jugador de arriba (no suman
  -- 100% entre sí, cada uno se calcula sobre el rake total por separado) — es la parte del rake
  -- que vuelve como rakeback pero queda para la banca en vez de para el jugador. Se suma como
  -- ganancia real de la banca (ver engine/bancados.ts).
  rakeback_banca_pct   NUMERIC(6,4) NOT NULL DEFAULT 0,
  -- % que "la Unión" (o quien corresponda) le da a la banca sobre el rake total generado (ej.
  -- 80%) — puramente INFORMATIVO, no mueve plata en el sistema (no genera ningún movimiento de
  -- Wallet/Tesorería), es solo para que quede visible cuánto de eso le corresponde reclamar.
  -- Configurable por jugador porque puede cambiar según el club/acuerdo.
  union_share_pct      NUMERIC(6,4) NOT NULL DEFAULT 0,
  capital_inicial      NUMERIC(18,4) NOT NULL DEFAULT 0,
  makeup_inicial       NUMERIC(18,4) NOT NULL DEFAULT 0,
  moneda               TEXT NOT NULL DEFAULT 'USD',
  regla                TEXT,
  observaciones        TEXT,
  recuperacion_makeup  TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historial de cierres de banca — un registro por jugador+semana, igual que HISTORIAL_BANCADOS_
-- MASTER de la planilla (acá no hace falta una hoja individual por jugador aparte, se filtra por
-- player_id). status='REVERTIDO' (mismo patrón que weekly_closings, BIT-001) en vez de borrar:
-- un cierre revertido no cuenta para el estado vigente (capital/makeup actual) ni bloquea volver
-- a cerrar esa semana.
CREATE TABLE IF NOT EXISTS bancado_historial (
  id                          TEXT PRIMARY KEY,
  player_id                   TEXT NOT NULL REFERENCES players(id),
  agent_id                    TEXT REFERENCES agents(id),
  club_id                     TEXT NOT NULL REFERENCES clubs(id),
  -- 'CIERRE_SEMANAL' (default, todo lo de antes) o 'RECARGA_CAPITAL' (18/09/2026): un ajuste
  -- manual de capital sin resultado de mesas — para cuando el jugador pierde todo su capital y
  -- hay que volver a cargarle fichas, algo que antes solo se podía hacer una vez (capital_inicial
  -- en la config, que además deja de tener efecto en cuanto existe algún cierre semanal). En una
  -- fila RECARGA_CAPITAL: resultado_mesas guarda el monto de la recarga (puede ser negativo para
  -- un descuento), rake/rakeback/makeup/pago/ganancia quedan todos en 0 (no las toca), y
  -- capital_despues = capital_anterior + resultado_mesas — igual que la fórmula normal del
  -- capital, ver engine/bancados.ts.
  tipo                         TEXT NOT NULL DEFAULT 'CIERRE_SEMANAL',
  week_start                  DATE NOT NULL,
  week_end                    DATE NOT NULL,
  resultado_mesas             NUMERIC(18,4) NOT NULL,
  rake_total                  NUMERIC(18,4) NOT NULL,
  rakeback_total               NUMERIC(18,4) NOT NULL,
  makeup_anterior              NUMERIC(18,4) NOT NULL,
  perdida_agrega_makeup       NUMERIC(18,4) NOT NULL,
  rakeback_a_makeup           NUMERIC(18,4) NOT NULL,
  rakeback_excedente_jugador  NUMERIC(18,4) NOT NULL,
  makeup_nuevo                NUMERIC(18,4) NOT NULL,
  pago_jugador_mesas          NUMERIC(18,4) NOT NULL,
  pago_jugador_total          NUMERIC(18,4) NOT NULL,
  ganancia_banca_mesas        NUMERIC(18,4) NOT NULL,
  -- Rakeback Banca de esta semana (real, ya sumado dentro de ganancia_banca_mesas) y el %
  -- informativo de la Unión sobre el rake total de esta semana (no suma a ninguna ganancia,
  -- solo se guarda para verlo). Ver engine/bancados.ts.
  rakeback_banca_total        NUMERIC(18,4) NOT NULL DEFAULT 0,
  rakeback_banca_pct_snapshot NUMERIC(6,4) NOT NULL DEFAULT 0,
  union_share_total           NUMERIC(18,4) NOT NULL DEFAULT 0,
  union_share_pct_snapshot    NUMERIC(6,4) NOT NULL DEFAULT 0,
  capital_anterior             NUMERIC(18,4) NOT NULL,
  capital_despues              NUMERIC(18,4) NOT NULL,
  pct_jugador_snapshot        NUMERIC(6,4) NOT NULL,
  pct_banca_snapshot          NUMERIC(6,4) NOT NULL,
  rakeback_pct_snapshot       NUMERIC(6,4) NOT NULL,
  observaciones                TEXT,
  status                      TEXT NOT NULL DEFAULT 'ACTIVO',
  motivo_reversion             TEXT,
  created_by                  TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- El "no duplicar la misma semana" solo aplica a cierres semanales de verdad — una recarga de
-- capital no tiene semana propia (se anota con la fecha del día que se carga) y puede haber más
-- de una el mismo día sin problema.
CREATE UNIQUE INDEX IF NOT EXISTS bancado_historial_player_week_active_key
  ON bancado_historial(player_id, week_start)
  WHERE status <> 'REVERTIDO' AND tipo = 'CIERRE_SEMANAL';
CREATE INDEX IF NOT EXISTS bancado_historial_player_idx ON bancado_historial(player_id, week_start DESC);

-- Botón "Pagar" (18/09/2026): registra el pago de un cierre semanal ya cerrado como un EGRESO
-- en treasury_adjustments (ledger WALLET_MANOS), y anota acá cuándo y con qué movimiento —
-- así el botón se puede deshabilitar/mostrar "Pagado" sin depender de ir a buscarlo a Wallet
-- cada vez, y no se puede pagar dos veces el mismo cierre por error.
ALTER TABLE bancado_historial ADD COLUMN IF NOT EXISTS wallet_pagado_at TIMESTAMPTZ;
ALTER TABLE bancado_historial ADD COLUMN IF NOT EXISTS wallet_movement_id TEXT;

-- Ticket promocional (21/09/2026, ver engine/bancados.ts) -- regalo a un jugador bancado pagado
-- por DigiPlayers: resta solo de ganancia_banca_mesas, nunca del pago/capital/makeup del bancado.
ALTER TABLE bancado_historial ADD COLUMN IF NOT EXISTS ticket_promocional NUMERIC(18,4) NOT NULL DEFAULT 0;
ALTER TABLE bancado_historial ADD COLUMN IF NOT EXISTS ticket_promocional_nota TEXT;

-- ============ COMPENSACIÓN DE JUAN — cierres de socio ruteados a cuenta de socio (15/09/2026) ============
-- Juan es socio/jefe de la operación, no un agente común: sus cierres semanales de póker (y otros
-- movimientos) no le forman un "balance" propio en la tabla balances — mueven su deuda/saldo
-- pendiente con la empresa, que ya se maneja en partner_account_entries (módulo "Cuentas de
-- socios", control 100% manual). Esto agrega el enganche automático: cuando un agente tiene
-- person_key seteado, su cierre semanal se rutea a la cuenta de socio de ese nombre en lugar de
-- tocar balances/ledger_movements — igual que hace hoy CAJERO_CREDITO/BANCADO con sus propias tablas.
--
-- Convención de signo (igual que la planilla vieja: "ajuste = -cierreJuan"): si Juan ganó la
-- semana (final_closing positivo), ESO REDUCE lo que le debe a la empresa → amount negativo en
-- partner_account_entries. Si perdió, aumenta la deuda → amount positivo.

-- Traza de qué cierre semanal generó qué movimiento de socio (para no duplicar y para poder
-- auditar "¿de dónde salió este monto?" sin adivinar).
ALTER TABLE partner_account_entries ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE partner_account_entries ADD COLUMN IF NOT EXISTS source_agent_id TEXT REFERENCES agents(id);
ALTER TABLE partner_account_entries ADD COLUMN IF NOT EXISTS source_club_id TEXT REFERENCES clubs(id);
ALTER TABLE partner_account_entries ADD COLUMN IF NOT EXISTS source_week_start DATE;
CREATE UNIQUE INDEX IF NOT EXISTS partner_account_entries_idempotency_key
  ON partner_account_entries(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Deja constancia en el propio cierre semanal de que fue ruteado a una cuenta de socio (para que
-- el historial de cierres del agente pueda mostrar "va a cuenta de Juan" en vez de un balance que
-- nunca se movió).
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS routed_to_partner_account_id TEXT REFERENCES partner_accounts(id);

-- Bootstrap idempotente: asegura que exista la cuenta de socio "Juan" (si el usuario ya la creó
-- a mano con otro nombre, esto no crea una duplicada — hay que unificar a mano en ese caso).
INSERT INTO partner_accounts (id, name, description)
SELECT 'juan', 'Juan', 'Compensación automática por cierres semanales (J Chamacos, Juan, Juan Masters, Guerrrda) + movimientos manuales (sueldo manos, gastos, USDT)'
WHERE NOT EXISTS (SELECT 1 FROM partner_accounts WHERE lower(name) = 'juan');

-- Data fix idempotente: si alguna de las 4 identidades de club de Juan ya existe como agente,
-- la marca con person_key='juan' para que su cierre se rutee solo. Los agentes que todavía no
-- existan hay que crearlos a mano en Agentes (uno por club: J Chamacos / Juan / Juan Masters /
-- Guerrrda, los 4 a 70% rakeback) y ponerles "Cuenta de socio: Juan" desde el formulario de editar.
UPDATE agents SET person_key = 'juan'
  WHERE lower(name) IN ('juan', 'j chamacos', 'juan masters', 'guerrrda', 'guerrda')
  AND (person_key IS NULL OR person_key <> 'juan');

-- ============ GANANCIAS POR PERÍODO + AJUSTES EXTRAORDINARIOS (recreación de las pestañas
-- GANANCIAS_POR_PERIODO y AJUSTES EXTRAORDINARIOS de la planilla, 15/09/2026) ============
-- Un "período" es simplemente un nombre puesto a mano sobre un grupo de semanas ya cerradas
-- (4, 5, 6 semanas, las que sea — no tiene que ser un mes calendario). Mientras está ABIERTO
-- se recalcula en vivo; al cerrarlo se congela una foto (no se recalcula más aunque después
-- se carguen retiros/gastos con fecha vieja) — igual que "Cerrado" en la planilla.
CREATE TABLE IF NOT EXISTS profit_periods (
  id                        TEXT PRIMARY KEY,
  name                      TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'ABIERTO' CHECK (status IN ('ABIERTO','CERRADO')),
  -- Snapshot: solo se completan al cerrar (ver closePeriod). NULL mientras está ABIERTO —
  -- la vista previa se calcula en vivo, no se guarda hasta que se cierra de verdad.
  ganancia_operativa        NUMERIC(18,4),
  retiros                   NUMERIC(18,4),
  gastos                    NUMERIC(18,4),
  ingresos_ajustes          NUMERIC(18,4),
  ganancia_antes_ajustes_dp NUMERIC(18,4),
  ajustes_extraordinarios_dp NUMERIC(18,4),
  ganancia_neta_final       NUMERIC(18,4),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at                 TIMESTAMPTZ
);

-- Qué semanas (across todos los clubes) forman este período.
CREATE TABLE IF NOT EXISTS profit_period_weeks (
  id         TEXT PRIMARY KEY,
  period_id  TEXT NOT NULL REFERENCES profit_periods(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  UNIQUE(period_id, week_start)
);
CREATE INDEX IF NOT EXISTS profit_period_weeks_period_idx ON profit_period_weeks(period_id);

-- Pérdidas/retenciones extraordinarias (fichas confiscadas, retenciones de club, etc.) cuya
-- parte a cargo de DigiPlayers se amortiza en cuotas contra la ganancia de los próximos
-- períodos que se vayan cerrando — no se descuenta todo de una — hasta agotar
-- absorbe_digiplayers en periodos_totales cuotas iguales (o 1 sola cuota si es "Personalizado").
CREATE TABLE IF NOT EXISTS extraordinary_adjustments (
  id                  TEXT PRIMARY KEY,
  occurred_at         DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo                TEXT NOT NULL,
  descripcion         TEXT NOT NULL,
  responsable         TEXT,
  club_agencia        TEXT,
  monto_original      NUMERIC(18,4) NOT NULL,
  absorbe_digiplayers NUMERIC(18,4) NOT NULL DEFAULT 0,
  absorbe_agente      NUMERIC(18,4) NOT NULL DEFAULT 0,
  absorbe_supervisor  NUMERIC(18,4) NOT NULL DEFAULT 0,
  modo_distribucion   TEXT NOT NULL DEFAULT 'IGUAL_POR_PERIODO' CHECK (modo_distribucion IN ('IGUAL_POR_PERIODO','PERSONALIZADO')),
  periodos_totales    INTEGER NOT NULL DEFAULT 1 CHECK (periodos_totales >= 1),
  periodos_aplicados  INTEGER NOT NULL DEFAULT 0,
  estado              TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','FINALIZADO')),
  afectado_tipo       TEXT,
  afectado_nombre     TEXT,
  observaciones       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Traza de qué cuota de qué ajuste se consumió al cerrar qué período — para poder reabrir un
-- período (deshacer la cuota que consumió) sin perder el historial de las demás.
CREATE TABLE IF NOT EXISTS extraordinary_adjustment_applications (
  id            TEXT PRIMARY KEY,
  adjustment_id TEXT NOT NULL REFERENCES extraordinary_adjustments(id) ON DELETE CASCADE,
  period_id     TEXT NOT NULL REFERENCES profit_periods(id) ON DELETE CASCADE,
  amount        NUMERIC(18,4) NOT NULL,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(adjustment_id, period_id)
);
CREATE INDEX IF NOT EXISTS extraordinary_adjustment_applications_period_idx ON extraordinary_adjustment_applications(period_id);
CREATE INDEX IF NOT EXISTS extraordinary_adjustment_applications_adjustment_idx ON extraordinary_adjustment_applications(adjustment_id);

-- Historial de liquidaciones "guardadas" (15/09/2026): a diferencia de la vista de arriba, que
-- siempre recalcula en vivo contra weekly_closings/rakeback_advances, esto congela una FOTO de
-- lo que se le mandó de verdad a la persona/grupo (filas, totales, nota) — para poder consultar
-- después "¿qué le mandamos a Prodigio la semana pasada?" sin depender de que nada se haya
-- revertido o corregido desde entonces.
CREATE TABLE IF NOT EXISTS liquidaciones_guardadas (
  id                    TEXT PRIMARY KEY,
  nombre_grupo          TEXT NOT NULL,
  agent_ids             TEXT[] NOT NULL,
  week_start            DATE NOT NULL,
  week_end              DATE NOT NULL,
  filas                 JSONB NOT NULL,
  total                 NUMERIC(18,4) NOT NULL,
  adelantos_aplicados   NUMERIC(18,4) NOT NULL DEFAULT 0,
  adelantos_manual      NUMERIC(18,4) NOT NULL DEFAULT 0,
  cargas_aplicadas      NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_a_pagar         NUMERIC(18,4) NOT NULL,
  nota                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            TEXT
);
CREATE INDEX IF NOT EXISTS liquidaciones_guardadas_week_idx ON liquidaciones_guardadas(week_start DESC);
-- cargas_aplicadas (21/09/2026): agregado despues de que la tabla ya existia en produccion --
-- CREATE TABLE IF NOT EXISTS de arriba no la agrega sola en una base que ya la tenia creada.
ALTER TABLE liquidaciones_guardadas ADD COLUMN IF NOT EXISTS cargas_aplicadas NUMERIC(18,4) NOT NULL DEFAULT 0;

-- Un mismo login de portal ahora puede ver más de un agente/club (15/09/2026) — ej. una persona
-- que tiene identidades separadas en varios clubes (mismo caso de fondo que Cuenta de socio de
-- Juan, pero para el PORTAL en vez del ledger interno). agent_users.agent_id se mantiene como
-- "cuenta principal" (la que usa el login/JWT por default) — esta tabla es el AGREGADO de todo
-- lo que ese login puede elegir ver desde el selector de "Mi cuenta".
CREATE TABLE IF NOT EXISTS agent_user_agents (
  user_id  TEXT NOT NULL REFERENCES agent_users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  PRIMARY KEY (user_id, agent_id)
);
-- Backfill idempotente: todo usuario que ya existía queda con su único agente de siempre
-- también acá — cero cambio de comportamiento hasta que un admin le agregue más desde Usuarios.
INSERT INTO agent_user_agents (user_id, agent_id)
  SELECT id, agent_id FROM agent_users
  ON CONFLICT DO NOTHING;

-- Rol SUPERVISOR (16/09/2026): un login de portal que, en vez de "Mi cuenta" de un solo agente,
-- ve el resumen de su grupo de agentes a cargo (mismo dato que ya arma /dashboard/supervisores
-- para el admin, filtrado a su propio nombre) — para cuando su agent_id principal es de
-- account_type='SUPERVISOR'. El CHECK de agent_users.role de arriba puede no actualizarse solo
-- en una base que ya existía (CREATE TABLE IF NOT EXISTS no toca constraints existentes), así
-- que se recrea acá de forma idempotente.
ALTER TABLE agent_users DROP CONSTRAINT IF EXISTS agent_users_role_check;
ALTER TABLE agent_users ADD CONSTRAINT agent_users_role_check CHECK (role IN ('AGENT','ADMIN','SUPERVISOR'));

-- Comisión por referido de supervisor (16/09/2026, corregido el mismo día): un supervisor
-- puede tener % configurado sobre el rake semanal de un agente que ÉL REFIRIÓ (distinto de
-- rebate_destino=RAKEBACK_SUPERVISOR, que es para agentes administrativamente A CARGO del
-- supervisor vía agents.supervisor). Se auto-acredita en cada cierre semanal del agente
-- referido (ver aplicarCierreSemanal), separado de la liquidación propia de ese agente — mismo
-- espíritu que la planilla vieja (hoja MEMORIA_URIEL): comisión = rake semanal del referido × %,
-- tracked como saldo corriente.
-- A PROPÓSITO cuelga del LOGIN (agent_users), no de un agente: a diferencia de "agentes a
-- cargo" (que sí necesita un agente real porque agents.supervisor se resuelve por nombre), esto
-- es pura configuración de "quién cobra qué %" y no debe depender de cuál sea la cuenta
-- principal (agent_id) de ese login — evita tener que inventar un agente dummy solo para que
-- el supervisor pueda cobrar una comisión.
-- Un agente referido solo puede tener UN referidor activo a la vez (evita ambigüedad de a quién
-- le corresponde el % si hubiera más de uno).
CREATE TABLE IF NOT EXISTS supervisor_referidos (
  id                    TEXT PRIMARY KEY,
  supervisor_user_id    TEXT NOT NULL REFERENCES agent_users(id) ON DELETE CASCADE,
  agente_referido_id    TEXT NOT NULL REFERENCES agents(id),
  porcentaje            NUMERIC NOT NULL CHECK (porcentaje > 0 AND porcentaje <= 100),
  saldo                 NUMERIC NOT NULL DEFAULT 0,
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS supervisor_referidos_activo_unico
  ON supervisor_referidos (agente_referido_id) WHERE active;

-- Histórico de movimientos del saldo de referido (mismo patrón que rakeback_advance_movements):
-- COMISION = acreditación automática por un cierre semanal; CORRECCION = ajuste manual o
-- reversa de un cierre revertido.
CREATE TABLE IF NOT EXISTS supervisor_referido_movements (
  id                 TEXT PRIMARY KEY,
  referido_id        TEXT NOT NULL REFERENCES supervisor_referidos(id),
  weekly_closing_id  TEXT REFERENCES weekly_closings(id),
  type               TEXT NOT NULL CHECK (type IN ('COMISION','CORRECCION','PAGO')),
  amount             NUMERIC NOT NULL,
  resulting_saldo    NUMERIC NOT NULL,
  notes              TEXT,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supervisor_referido_movements_wc ON supervisor_referido_movements(weekly_closing_id);

-- Ajuste manual por cierre semanal (18/09/2026, pedido de Leo): "tickets promocionales" que se
-- cargan a mano en la grilla de cierre, agente por agente — nunca salen de un cálculo
-- automático. Se suman/restan directo al cierre final (ver engine/cierre.ts) y quedan guardados
-- acá para que se vean en el historial de cada cierre, con su motivo.
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS ajuste_manual NUMERIC(18,4) NOT NULL DEFAULT 0;
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS ajuste_manual_nota TEXT;

-- Resumen de club para Tiny GG (18/09/2026, pedido de Leo): a diferencia de los demas clubes,
-- la ganancia del club en Tiny no sale de un % fijo sobre el rake -- sale de la diferencia entre
-- lo que la Union/GG nos liquida a nosotros (Settlement) y lo que nosotros les pagamos a los
-- agentes (Cierre agentes). Dos piezas nuevas de datos hacen falta para reconstruir eso despues:
--
-- 1) BBJ Contribution por agente (informativo, viene del reporte de Tiny, nunca afecta el pago
--    de ningun agente) -- se guarda junto al resto del cierre, igual que jugadores/ring_game.
ALTER TABLE weekly_closings ADD COLUMN IF NOT EXISTS bbj_contribution NUMERIC(18,4) NOT NULL DEFAULT 0;

-- 2) El Rebate Union / Rake share de Tiny (hoy se calculan al importar y se muestran en el panel
--    de conciliacion de la pantalla de Cierres, pero se pierden apenas se cierra esa pantalla).
--    Se guarda una fila por archivo/super agente (un club+semana puede tener varios, ver
--    repo/importsTinyGG.ts) para no perder el desglose, con upsert idempotente por si se vuelve
--    a aplicar la misma semana (mismo criterio que weekly_closings: reintentar nunca duplica).
CREATE TABLE IF NOT EXISTS tiny_rebate_union (
  id                       TEXT PRIMARY KEY,
  club_id                  TEXT NOT NULL REFERENCES clubs(id),
  week_start               DATE NOT NULL,
  week_end                 DATE NOT NULL,
  file_name                TEXT NOT NULL,
  super_agent_nickname     TEXT,
  rg_pre_rake_excl_jp      NUMERIC(18,4),
  rebate_union_calculado   NUMERIC(18,4) NOT NULL DEFAULT 0,
  rebate_union_tiny        NUMERIC(18,4),
  rake_total_ring_game     NUMERIC(18,4),
  rate_pct                 NUMERIC(6,4),
  rake_share               NUMERIC(18,4),
  weekly_settlement_oficial NUMERIC(18,4),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (club_id, week_start, file_name)
);
CREATE INDEX IF NOT EXISTS idx_tiny_rebate_union_club_semana ON tiny_rebate_union(club_id, week_start);

-- ============ PROVEEDORES (22/09/2026, pedido de Leo) ============
-- Entidad SEPARADA de agents -- a propósito no se reutiliza la tabla de agentes ("no
-- mezclarlo con lo que ya tenemos"): un proveedor es una relación distinta (ej. Manzur como
-- "unión" en Fénix GG, que nos entrega el 75% del rake TOTAL del club, no un agente al 75%
-- de sus propios jugadores como en Fénix Suprema -- ver Cierres/Liquidaciones para ese caso).
-- Un mismo humano puede existir como agente (fila en agents) Y como proveedor (fila acá) al
-- mismo tiempo, son cuentas independientes que nunca se tocan entre sí.
CREATE TABLE IF NOT EXISTS proveedores (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  notes      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Auto-cierre (22/09/2026, pedido de Leo: "cuando se carga la info en resumen por club...
  -- que se haga automaticamente en proveedores, asi no tenemos que cargar de nuevo todo") --
  -- si se completan los dos campos, cada vez que se guarda "Ingreso por ventas" en Resumen
  -- por club de auto_cierre_club_id, se aplica solo (sin tocar nada a mano) el cierre semanal
  -- de este proveedor para esa misma semana, con este % de rakeback fijo. Si ya existe un
  -- cierre para esa semana (por ejemplo porque se guardó dos veces el resumen), se salta sin
  -- error -- nunca duplica.
  auto_cierre_club_id      TEXT REFERENCES clubs(id),
  auto_cierre_rakeback_pct NUMERIC(6,4)
);

-- La tabla proveedores ya existia (CREATE TABLE IF NOT EXISTS de arriba no la toca si ya
-- fue creada antes de agregar estas dos columnas) -- estas dos lineas son las que realmente
-- agregan auto_cierre_club_id / auto_cierre_rakeback_pct en una base que ya tenia la tabla.
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS auto_cierre_club_id TEXT REFERENCES clubs(id);
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS auto_cierre_rakeback_pct NUMERIC(6,4);

-- Multi-club de auto-cierre (22/09/2026, pedido de Leo -- caso Manzur: M CHOCO/Suprema Y
-- Fénix GG a la vez, no uno solo). Reemplaza en los hechos a auto_cierre_club_id/
-- auto_cierre_rakeback_pct (que quedan para no romper filas viejas, pero ya no se usan para
-- decidir el auto-cierre): un proveedor puede tener CUALQUIER cantidad de clubes configurados,
-- cada uno con su propio % de rakeback. Al guardar el resumen semanal de un club, se aplica
-- (o se agrega como línea nueva a un cierre ya existente de esa semana) el cierre automático
-- de todos los proveedores que tengan ese club configurado acá.
CREATE TABLE IF NOT EXISTS proveedor_auto_cierre_clubes (
  id           TEXT PRIMARY KEY,
  proveedor_id TEXT NOT NULL REFERENCES proveedores(id),
  club_id      TEXT NOT NULL REFERENCES clubs(id),
  rakeback_pct NUMERIC(6,4) NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proveedor_id, club_id)
);
CREATE INDEX IF NOT EXISTS proveedor_auto_cierre_clubes_club_idx ON proveedor_auto_cierre_clubes(club_id);

-- Migra la config vieja (single-club) a la tabla nueva (multi-club) para no perder lo que
-- Leo ya tenía cargado (ej. Manzur -> Fénix GG 75%).
INSERT INTO proveedor_auto_cierre_clubes (id, proveedor_id, club_id, rakeback_pct)
SELECT 'pacc_' || substr(md5(id || club_id_aux), 1, 20), id, club_id_aux, rakeback_aux
FROM (
  SELECT id, auto_cierre_club_id AS club_id_aux, auto_cierre_rakeback_pct AS rakeback_aux
  FROM proveedores
  WHERE auto_cierre_club_id IS NOT NULL AND auto_cierre_rakeback_pct IS NOT NULL
) sub
ON CONFLICT (proveedor_id, club_id) DO NOTHING;

-- Saldo operativo acumulado por proveedor+club (mismo criterio de signo que balances:
-- positivo = a favor del proveedor/le debemos, negativo = a favor nuestro/nos debe). Se
-- actualiza con cada cierre semanal y cada pago -- nunca se toca a mano.
CREATE TABLE IF NOT EXISTS proveedor_saldos (
  id           TEXT PRIMARY KEY,
  proveedor_id TEXT NOT NULL REFERENCES proveedores(id),
  club_id      TEXT NOT NULL REFERENCES clubs(id),
  amount       NUMERIC(18,4) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(proveedor_id, club_id)
);

-- Cierre semanal de proveedor (22/09/2026, rediseñado a pedido de Leo para el caso Manzur:
-- "esto está en proceso de crecimiento, hacelo completo"). Un cierre de proveedor cubre UNA
-- semana (proveedor_id + week_start es la clave, ya NO un solo club_id como antes) y puede
-- estar compuesto por VARIAS líneas (proveedor_cierre_lineas): cada línea es o bien el total
-- de UN club ("Manzur es la unión", ej. Fénix GG) o bien el cierre de UN agente puntual ya
-- aplicado en Cierres semanales (ej. M CHOCO en Fénix Suprema, mismo agente que ya tiene su
-- propia cuenta normal en Agentes -- ver "no mezclarlo" del 22/09). Esta tabla queda como
-- cabecera/resumen: cierre = suma de monto_aplicado de todas sus líneas; saldo_anterior/
-- saldo_nuevo son la suma de los saldos (por club, ver proveedor_saldos) tocados por este
-- cierre, antes y después -- el detalle exacto por club/línea vive en proveedor_cierre_lineas.
CREATE TABLE IF NOT EXISTS proveedor_cierres (
  id               TEXT PRIMARY KEY,
  proveedor_id     TEXT NOT NULL REFERENCES proveedores(id),
  club_id          TEXT REFERENCES clubs(id), -- legado (una sola línea); NULL en cierres multi-línea nuevos
  week_start       DATE NOT NULL,
  week_end         DATE NOT NULL,
  resultado_total  NUMERIC(18,4), -- legado, solo tenía sentido con un único club
  rake_total       NUMERIC(18,4), -- legado
  rakeback_pct     NUMERIC(6,4),  -- legado
  rakeback_monto   NUMERIC(18,4), -- legado
  cierre           NUMERIC(18,4) NOT NULL, -- total real: suma de monto_aplicado de todas las líneas
  saldo_anterior   NUMERIC(18,4) NOT NULL,
  saldo_nuevo      NUMERIC(18,4) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'APLICADO' CHECK (status IN ('APLICADO','REVERTIDO')),
  notes            TEXT,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(proveedor_id, club_id, week_start)
);
-- Columnas legado pasan a ser opcionales: un cierre multi-línea (varios clubes y/o agentes)
-- ya no tiene un único club_id/resultado_total/rake_total/rakeback_pct/rakeback_monto propio.
ALTER TABLE proveedor_cierres ALTER COLUMN club_id DROP NOT NULL;
ALTER TABLE proveedor_cierres ALTER COLUMN resultado_total DROP NOT NULL;
ALTER TABLE proveedor_cierres ALTER COLUMN rake_total DROP NOT NULL;
ALTER TABLE proveedor_cierres ALTER COLUMN rakeback_pct DROP NOT NULL;
ALTER TABLE proveedor_cierres ALTER COLUMN rakeback_monto DROP NOT NULL;
-- La clave idempotente pasa a ser proveedor+semana (ya no proveedor+club+semana): un cierre
-- ahora puede cubrir varios clubes a la vez, así que el UNIQUE viejo (que además exigía club_id
-- NOT NULL) ya no aplica. Índice parcial que ignora los REVERTIDO, mismo patrón que
-- weekly_closings (permite re-cerrar una semana después de revertir el cierre anterior).
ALTER TABLE proveedor_cierres DROP CONSTRAINT IF EXISTS proveedor_cierres_proveedor_id_club_id_week_start_key;
CREATE UNIQUE INDEX IF NOT EXISTS proveedor_cierres_proveedor_week_active_key
  ON proveedor_cierres(proveedor_id, week_start)
  WHERE status <> 'REVERTIDO';

-- Detalle línea por línea de un proveedor_cierre (22/09/2026). tipo=CLUB: se toma el total del
-- club completo (getResumenClubSemanal) y se guarda INVERTIDO (x -1) -- ESTA inversión es
-- exclusiva de Proveedores, no toca la convención de signo del resto del sistema (agentes,
-- resumen por club, etc. siguen igual que siempre). tipo=AGENTE: se toma el final_closing YA
-- CALCULADO de un weekly_closings existente de ese agente+club+semana (Cierres semanales) y se
-- guarda TAL CUAL, sin invertir -- ver explicación de Leo sobre M CHOCO/Manzur: al pasar por
-- Manzur el signo del agente se invierte una vez, y al persistir en Proveedores se invierte
-- una segunda vez, así que las dos inversiones se cancelan matemáticamente.
CREATE TABLE IF NOT EXISTS proveedor_cierre_lineas (
  id                TEXT PRIMARY KEY,
  cierre_id         TEXT NOT NULL REFERENCES proveedor_cierres(id),
  tipo              TEXT NOT NULL CHECK (tipo IN ('CLUB','AGENTE')),
  club_id           TEXT NOT NULL REFERENCES clubs(id),
  agent_id          TEXT REFERENCES agents(id),                    -- solo tipo AGENTE
  weekly_closing_id TEXT REFERENCES weekly_closings(id),            -- solo tipo AGENTE (trazabilidad)
  resultado_total   NUMERIC(18,4),  -- solo tipo CLUB
  rake_total        NUMERIC(18,4),  -- solo tipo CLUB
  rakeback_pct      NUMERIC(6,4),   -- solo tipo CLUB
  -- Rebate que el CLUB nos reconoce a nosotros (22/09/2026, pedido de Leo) -- CONCEPTO
  -- DISTINTO del rebate de agentes que ya existe en weekly_closings.rebate (ese ya está
  -- adentro de cada final_closing de agente, nunca se reutiliza acá para no contarlo dos
  -- veces). Depende de la familia del club: TeamBack GG = (resultado_total + rake_total) ×
  -- -10% siempre; Tiny = reutiliza el rebate ya calculado y probado de tiny_rebate_union
  -- (getResumenTinyExtra().rebateGlobal); Fénix GG y Suprema = 0. Solo aplica a tipo CLUB.
  club_rebate       NUMERIC(18,4),
  -- Rodeo (solo SupremaPoker: Fénix/TeamBack Suprema, 0 en cualquier otro club de fábrica,
  -- ver engine/rodeo.ts) = -rodeo_pagado_agentes del resumen del club. Solo aplica a tipo CLUB.
  impacto_rodeo     NUMERIC(18,4),
  monto_crudo       NUMERIC(18,4) NOT NULL, -- el cierre "en bruto" de la línea, SIN invertir
  monto_aplicado    NUMERIC(18,4) NOT NULL, -- lo que realmente se sumó al saldo proveedor+club de esta línea
  saldo_anterior    NUMERIC(18,4) NOT NULL, -- saldo de ese proveedor+club antes de esta línea (dentro del mismo cierre)
  saldo_nuevo       NUMERIC(18,4) NOT NULL, -- saldo de ese proveedor+club después de esta línea
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proveedor_cierre_lineas_cierre_idx ON proveedor_cierre_lineas(cierre_id);

-- La tabla proveedor_cierre_lineas ya existia de antes (CREATE TABLE IF NOT EXISTS de arriba
-- no la toca si ya fue creada) -- estas dos lineas son las que realmente agregan club_rebate/
-- impacto_rodeo en una base que ya tenia la tabla (mismo patron que auto_cierre_club_id mas
-- arriba). Sin esto, "npm run migrate" no rompe pero tampoco agrega las columnas, y el cierre
-- de proveedor falla con "column club_rebate of relation proveedor_cierre_lineas does not
-- exist" -- bug real detectado 22/09/2026.
ALTER TABLE proveedor_cierre_lineas ADD COLUMN IF NOT EXISTS club_rebate NUMERIC(18,4);
ALTER TABLE proveedor_cierre_lineas ADD COLUMN IF NOT EXISTS impacto_rodeo NUMERIC(18,4);

-- Pagos/cobros (USDT u otro medio) contra el saldo del proveedor -- separados del cálculo del
-- cierre semanal (Leo, punto 4 del texto sobre Manzur: "los pagos USDT deben mostrarse por
-- separado y aplicarse al saldo, no modificando la fórmula del cierre semanal").
CREATE TABLE IF NOT EXISTS proveedor_pagos (
  id             TEXT PRIMARY KEY,
  proveedor_id   TEXT NOT NULL REFERENCES proveedores(id),
  club_id        TEXT NOT NULL REFERENCES clubs(id),
  amount         NUMERIC(18,4) NOT NULL,
  medio          TEXT NOT NULL DEFAULT 'USDT' CHECK (medio IN ('USDT','EFECTIVO','ZELLE','OTRO')),
  direction      TEXT NOT NULL CHECK (direction IN ('PAGO','COBRO')),
  saldo_anterior NUMERIC(18,4) NOT NULL,
  saldo_nuevo    NUMERIC(18,4) NOT NULL,
  status         TEXT NOT NULL DEFAULT 'APLICADO' CHECK (status IN ('APLICADO','REVERTIDO')),
  notes          TEXT,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     TEXT
);

-- Garantía de un proveedor -- mismo mecanismo que guarantees/guarantee_movements (BIT-034:
-- separada del saldo operativo), pero en su propia tabla para no mezclar con las garantías
-- de agentes.
CREATE TABLE IF NOT EXISTS proveedor_garantias (
  id           TEXT PRIMARY KEY,
  proveedor_id TEXT NOT NULL REFERENCES proveedores(id),
  amount       NUMERIC(18,4) NOT NULL DEFAULT 0,
  consumed     NUMERIC(18,4) NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proveedor_garantia_movements (
  id                  TEXT PRIMARY KEY,
  proveedor_id        TEXT NOT NULL REFERENCES proveedores(id),
  garantia_id         TEXT NOT NULL REFERENCES proveedor_garantias(id),
  type                TEXT NOT NULL CHECK (type IN ('ALTA','AUMENTO','REDUCCION','CONSUMO','BAJA')),
  amount              NUMERIC(18,4) NOT NULL,
  resulting_amount    NUMERIC(18,4) NOT NULL,
  resulting_consumed  NUMERIC(18,4) NOT NULL,
  notes               TEXT,
  created_by          TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Subagentes" (23/09/2026, pedido de Leo): un jugador puntual de un agente puede tener su
-- propio % de rakeback (distinto al % general del agente), agrupado bajo un nombre propio
-- (ej. "SG" agrupa a los jugadores "SG DeSueldo" + "Tony The Kid") -- sirve para liquidarle a
-- ese subgrupo de jugadores aparte, con un % menor, y que la diferencia quede de margen para
-- el agente principal (ver "Resumen por agente" / PDF de estado de cuenta). Config fija y
-- persistida por jugador (no se elige a mano en cada reporte) -- se edita desde el árbol de
-- Club->Agentes->Jugadores en Agentes.tsx. NULL = jugador normal, sin subagente (la gran
-- mayoría). subagente_rakeback_pct es obligatorio si subagente_name no es NULL (se valida del
-- lado de la app, no acá, mismo criterio que el resto de los % del sistema).
ALTER TABLE players ADD COLUMN IF NOT EXISTS subagente_name TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS subagente_rakeback_pct NUMERIC(6,4);

-- Detalle por jugador de cada cierre semanal (23/09/2026, pedido de Leo: "Resumen por agente"
-- en PDF, réplica de una planilla que ya usa a mano). Antes de esto el sistema solo guardaba el
-- agregado por agente+club en weekly_closings -- el desglose jugador por jugador se usaba una
-- vez al importar y se descartaba. Desde ahora se persiste automáticamente, DENTRO de la misma
-- transacción que aplicarCierreSemanal (mismo criterio que rodeo_detalle/bancado_historial):
-- si el cierre es preview (rollback), esto nunca llega a existir de verdad. Solo tiene datos
-- para cierres aplicados DESPUÉS de esta migración -- los históricos no se pueden reconstruir
-- (la info de origen no se guardaba en ningún lado).
-- rebate/rakeback/cierre = calculados con el % VIGENTE DEL AGENTE al momento del cierre (igual
-- que hoy). Si el jugador tiene subagente_name configurado en ese momento, ADEMÁS se guarda su
-- propia liquidación (mismo resultado/rake, pero al % del subagente) -- ver columnas *_subagente.
CREATE TABLE IF NOT EXISTS weekly_closing_player_details (
  id                        TEXT PRIMARY KEY,
  closing_id                TEXT NOT NULL REFERENCES weekly_closings(id),
  player_id                 TEXT REFERENCES players(id),
  player_external_id        TEXT NOT NULL,
  player_name               TEXT NOT NULL,
  resultado                 NUMERIC(18,4) NOT NULL DEFAULT 0,
  rake                      NUMERIC(18,4) NOT NULL DEFAULT 0,
  rebate_pct                NUMERIC(6,4) NOT NULL DEFAULT 0,
  rebate                    NUMERIC(18,4) NOT NULL DEFAULT 0,
  resultado_ajustado        NUMERIC(18,4) NOT NULL DEFAULT 0,
  rakeback_pct              NUMERIC(6,4) NOT NULL DEFAULT 0,
  rakeback                  NUMERIC(18,4) NOT NULL DEFAULT 0,
  cierre_jugador             NUMERIC(18,4) NOT NULL DEFAULT 0,
  -- Snapshot del subagente vigente al momento de este cierre (nombre + %) -- puede cambiar
  -- después sin afectar cierres ya aplicados, igual que el resto de los snapshots del sistema.
  subagente_name            TEXT,
  subagente_rakeback_pct    NUMERIC(6,4),
  subagente_rakeback        NUMERIC(18,4),
  subagente_cierre          NUMERIC(18,4),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wcpd_closing ON weekly_closing_player_details(closing_id);
CREATE INDEX IF NOT EXISTS idx_wcpd_player ON weekly_closing_player_details(player_id);

-- "Liquidaciones pendientes de pago" (24/09/2026, pedido de Leo): a veces no se sabe todavía
-- cómo va a querer cobrar el agente (fichas a un jugador puntual vs USDT) hasta que se le manda
-- la liquidación -- antes, si nadie apretaba "Guardar en historial" a mano, ese cálculo
-- (adelantos/cargas descontados, ventas/tickets, nota) se perdía apenas se cambiaba de agente o
-- se cerraba la pantalla. Ahora se autoguarda solo, como estado='PENDIENTE', apenas se calcula
-- una liquidación para un grupo de agentes + semana -- y pasa a 'PAGADA' automáticamente en
-- cuanto se registra CUALQUIER pago o cobro real para ese mismo grupo+semana (ver
-- routes/catalog.ts). DEFAULT 'PAGADA' a propósito: todo lo que ya estaba guardado hasta ahora
-- (con el botón manual "Guardar en historial") se asume resuelto, no aparece como pendiente.
ALTER TABLE liquidaciones_guardadas ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'PAGADA';
-- grupo_key = agent_ids ordenados y unidos por coma -- para poder buscar/upsertear por "mismo
-- grupo de agentes" sin importar el orden en que se seleccionaron.
ALTER TABLE liquidaciones_guardadas ADD COLUMN IF NOT EXISTS grupo_key TEXT;
-- Como mucho UN autoguardado "vivo" (PENDIENTE) por grupo+semana -- cada recálculo lo pisa en
-- vez de acumular filas repetidas. Las filas PAGADA (manuales o ya resueltas) no tienen este
-- límite, son historial de verdad.
CREATE UNIQUE INDEX IF NOT EXISTS idx_liquidaciones_pendiente_unica
  ON liquidaciones_guardadas(grupo_key, week_start) WHERE estado = 'PENDIENTE';

-- "Revisar" / rehacer una liquidación ya Pagada (23/09/2026 cont., pedido de Leo: "si ponemos
-- revisar deberia darte la opcion para rehacerla y por ejemplo el monto descontado lo puedas
-- volver a usar"): para poder liberar los adelantos/cargas que esta liquidación puntual dejó
-- consumidos (rakeback_advances/carga_pendientes_cruce, ver repo/advances.ts y
-- repo/cargaCruces.ts) hace falta saber CUÁLES movimientos de consumo le corresponden -- antes
-- no se guardaba esa referencia. Se llenan en /liquidacion/guardar y /liquidacion/autoguardar con
-- lo que haya en la sesión del navegador al momento de guardar; POST /liquidacion/liberar-cruces
-- los deshace (mismo mecanismo que "Deshacer último cruce" en Liquidaciones.tsx) y los vacía acá.
ALTER TABLE liquidaciones_guardadas ADD COLUMN IF NOT EXISTS adelanto_movement_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE liquidaciones_guardadas ADD COLUMN IF NOT EXISTS carga_movement_ids TEXT[] NOT NULL DEFAULT '{}';

-- ===================== TeamBack Affiliates V1 (25/09/2026, pedido de Leo) =====================
-- Sección TOTALMENTE APARTE del resto del sistema: agents/clubs/balances son el negocio de
-- "backing" de agentes que manejan mesas (DigiPlayers) -- esto es un programa de rakeback +
-- referidos DIRECTO AL JUGADOR, sobre Suprema Poker únicamente en V1. Tablas con prefijo tb_ a
-- propósito, para que nunca se mezclen ni por accidente con las tablas de agentes.
--
-- Reglas (bajada textual de Leo, 25/09/2026):
--  - Todo jugador arranca con 60% de rakeback semanal.
--  - Puede subir a 63%/65% por DOS caminos que NO son acumulables -- cada semana se toma el
--    mejor escalón alcanzado ESA semana (se recalcula todas las semanas, no es permanente):
--      * Volumen propio: >= USD 500 rake semanal -> 63%; >= USD 1.000 -> 65%.
--      * Referidos activos esa semana (>= USD 20 de rake bruto para contar como activo):
--        3 referidos activos -> 63%; 5 referidos activos -> 65%.
--  - Comisión de afiliado: 3% del rake bruto de cada referido DIRECTO (un solo nivel en V1,
--    aunque el árbol completo se guarda desde el día uno para poder pagar más niveles después
--    sin reconstruir historial). El umbral de USD 20 es configurable si también aplica a esta
--    comisión (tb_config.aplicar_umbral_a_comision) -- default FALSE: la comisión no tiene piso,
--    se paga sobre lo que haya rakeado cada referido esa semana, sea lo que sea.
--  - Cartera de afiliados: para seguir cobrando el 3%, el REFERENTE (no el referido) tiene que
--    haber tenido actividad propia en al menos 1 de las últimas 4 semanas (ventana móvil,
--    configurable). Si no, no pierde a sus referidos, pero la comisión de esa semana queda en
--    $0 (comision_3pct_pausada=true) -- no se paga retroactivo cuando vuelve a estar activo.

CREATE TABLE IF NOT EXISTS tb_config (
  id                          TEXT PRIMARY KEY DEFAULT 'default',
  pct_base                    NUMERIC(6,4) NOT NULL DEFAULT 0.60,
  pct_tier2                   NUMERIC(6,4) NOT NULL DEFAULT 0.63,
  pct_tier3                   NUMERIC(6,4) NOT NULL DEFAULT 0.65,
  umbral_volumen_tier2_usd    NUMERIC(18,4) NOT NULL DEFAULT 500,
  umbral_volumen_tier3_usd    NUMERIC(18,4) NOT NULL DEFAULT 1000,
  umbral_referidos_tier2      INTEGER NOT NULL DEFAULT 3,
  umbral_referidos_tier3      INTEGER NOT NULL DEFAULT 5,
  umbral_referido_activo_usd  NUMERIC(18,4) NOT NULL DEFAULT 20,
  pct_comision_referido       NUMERIC(6,4) NOT NULL DEFAULT 0.03,
  -- (pedido de Leo, 25/09/2026: "estaria bueno que eso se pueda configurar") -- si TRUE, un
  -- referido que no llegó a umbral_referido_activo_usd esa semana tampoco genera comisión para
  -- el referente esa semana (mismo umbral que para contar "referido activo" del escalón).
  aplicar_umbral_a_comision   BOOLEAN NOT NULL DEFAULT FALSE,
  ventana_actividad_semanas   INTEGER NOT NULL DEFAULT 4,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO tb_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS tb_players (
  id                 TEXT PRIMARY KEY,
  suprema_player_id  TEXT NOT NULL UNIQUE, -- nickname/ID de Suprema, como viene en el archivo
  name               TEXT NOT NULL,
  fecha_alta         DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Árbol de referidos: quién lo presentó. Self-referencing -- un solo padre por jugador, nunca
  -- se reasigna solo (cambiarlo es una acción explícita, ver repo/teamback.ts).
  referido_por_id    TEXT REFERENCES tb_players(id),
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tb_players_referido_por ON tb_players(referido_por_id);
CREATE INDEX IF NOT EXISTS idx_tb_players_suprema_id ON tb_players(suprema_player_id);

-- Una fila por jugador+semana, cargada desde el import semanal de Suprema (mismo parser crudo
-- que ya usa DigiPlayers, engine/importSuprema.ts -- incluso si estos jugadores no tienen nada
-- que ver con los agentes de DigiPlayers). Es el dato CRUDO (solo rake) -- todo lo demás
-- (escalón, comisión, etc.) se calcula a partir de esto y se guarda aparte en
-- tb_weekly_liquidations, nunca mezclado acá.
CREATE TABLE IF NOT EXISTS tb_weekly_stats (
  id            TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL REFERENCES tb_players(id),
  week_start    DATE NOT NULL,
  week_end      DATE NOT NULL,
  rake_bruto    NUMERIC(18,4) NOT NULL DEFAULT 0,
  import_source TEXT, -- nombre del archivo importado, para trazabilidad
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(player_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_tb_weekly_stats_week ON tb_weekly_stats(week_start);

-- La liquidación semanal YA CALCULADA de cada jugador -- persistida para que el histórico nunca
-- cambie si después se edita tb_config (cada fila guarda su propio config_snapshot con los %s y
-- umbrales vigentes al momento del cálculo, mismo criterio que otros "snapshot" del sistema).
CREATE TABLE IF NOT EXISTS tb_weekly_liquidations (
  id                        TEXT PRIMARY KEY,
  player_id                 TEXT NOT NULL REFERENCES tb_players(id),
  week_start                DATE NOT NULL,
  week_end                  DATE NOT NULL,
  rake_propio                NUMERIC(18,4) NOT NULL,
  referidos_activos_count    INTEGER NOT NULL,
  tier_alcanzado_por         TEXT NOT NULL, -- 'VOLUMEN' | 'REFERIDOS' | 'BASE'
  rakeback_pct               NUMERIC(6,4) NOT NULL,
  rakeback_generado          NUMERIC(18,4) NOT NULL,
  rake_referidos_directos    NUMERIC(18,4) NOT NULL,
  comision_3pct_bruta        NUMERIC(18,4) NOT NULL, -- lo que daría el 3% sin considerar pausa
  comision_3pct_pausada      BOOLEAN NOT NULL DEFAULT FALSE,
  comision_3pct_acreditada   NUMERIC(18,4) NOT NULL, -- 0 si está pausada, si no = bruta
  total_acreditado           NUMERIC(18,4) NOT NULL, -- rakeback_generado + comision_3pct_acreditada
  activo_en_ventana          BOOLEAN NOT NULL,
  config_snapshot            JSONB NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(player_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_tb_liq_week ON tb_weekly_liquidations(week_start);
CREATE INDEX IF NOT EXISTS idx_tb_liq_player ON tb_weekly_liquidations(player_id);

-- (25/09/2026, pedido de Leo: "deberiamos poder configurar a los jugadores y sus % no en
-- general como esta ahi") -- tb_config (arriba) empezó siendo la config que se le aplicaba a
-- TODOS los jugadores por igual. Leo pidió que cada jugador tenga su propio % base, sus propios
-- umbrales de escalón (63%/65%, por volumen o por referidos) y su propio % de comisión -- así
-- que ahora es esto (tb_player_config, una fila por jugador) lo que usa el motor de cálculo, NO
-- tb_config. tb_config queda solo como PLANTILLA -- valores para prellenar el formulario cuando
-- se configura un jugador nuevo por primera vez, nada más; el motor nunca la lee directamente.
--
-- Un jugador SIN fila acá no se puede liquidar (pedido explícito de Leo: "tiene que
-- configurarse sí o sí antes de calcular su liquidación", para evitar liquidar a alguien con un
-- % que nadie eligió a propósito) -- calcularYGuardarLiquidacionSemana() en repo/teamback.ts lo
-- salta y lo reporta aparte en vez de inventarle un % por defecto.
CREATE TABLE IF NOT EXISTS tb_player_config (
  player_id                   TEXT PRIMARY KEY REFERENCES tb_players(id),
  pct_base                    NUMERIC(6,4) NOT NULL,
  pct_tier2                   NUMERIC(6,4) NOT NULL,
  pct_tier3                   NUMERIC(6,4) NOT NULL,
  umbral_volumen_tier2_usd    NUMERIC(18,4) NOT NULL,
  umbral_volumen_tier3_usd    NUMERIC(18,4) NOT NULL,
  umbral_referidos_tier2      INTEGER NOT NULL,
  umbral_referidos_tier3      INTEGER NOT NULL,
  umbral_referido_activo_usd  NUMERIC(18,4) NOT NULL,
  pct_comision_referido       NUMERIC(6,4) NOT NULL,
  aplicar_umbral_a_comision   BOOLEAN NOT NULL DEFAULT FALSE,
  ventana_actividad_semanas   INTEGER NOT NULL,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
