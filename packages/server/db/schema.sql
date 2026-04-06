CREATE TABLE IF NOT EXISTS app_users (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
  room_code TEXT PRIMARY KEY,
  host_player_id TEXT NOT NULL,
  host_user_id TEXT,
  config_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_players (
  id BIGSERIAL PRIMARY KEY,
  room_code TEXT NOT NULL REFERENCES rooms(room_code) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  user_id TEXT,
  nickname TEXT NOT NULL,
  seat_index INT,
  stack INT NOT NULL,
  is_host BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(room_code, player_id)
);

CREATE TABLE IF NOT EXISTS hands (
  hand_id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL REFERENCES rooms(room_code) ON DELETE CASCADE,
  street TEXT NOT NULL,
  community_cards JSONB NOT NULL,
  winners_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS hand_actions (
  id BIGSERIAL PRIMARY KEY,
  hand_id TEXT NOT NULL REFERENCES hands(hand_id) ON DELETE CASCADE,
  room_code TEXT NOT NULL REFERENCES rooms(room_code) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  user_id TEXT,
  nickname TEXT NOT NULL,
  street TEXT NOT NULL,
  action_type TEXT NOT NULL,
  amount INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chip_adjustments (
  id BIGSERIAL PRIMARY KEY,
  room_code TEXT NOT NULL REFERENCES rooms(room_code) ON DELETE CASCADE,
  hand_id TEXT,
  actor_player_id TEXT NOT NULL,
  actor_user_id TEXT,
  target_player_id TEXT NOT NULL,
  target_user_id TEXT,
  before_value INT NOT NULL,
  after_value INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL REFERENCES rooms(room_code) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  user_id TEXT,
  nickname TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hand_player_results (
  id BIGSERIAL PRIMARY KEY,
  hand_id TEXT NOT NULL REFERENCES hands(hand_id) ON DELETE CASCADE,
  room_code TEXT NOT NULL REFERENCES rooms(room_code) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  chips_at_hand_start INT NOT NULL,
  end_chips INT NOT NULL,
  delta_chips INT NOT NULL,
  won_amount INT NOT NULL DEFAULT 0,
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  winning_hand_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(hand_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_stats (
  user_id TEXT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
  hands_played INT NOT NULL DEFAULT 0,
  hands_won INT NOT NULL DEFAULT 0,
  net_chips BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS host_user_id TEXT;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE hand_actions ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE chip_adjustments ADD COLUMN IF NOT EXISTS actor_user_id TEXT;
ALTER TABLE chip_adjustments ADD COLUMN IF NOT EXISTS target_user_id TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_hands_room_started_at ON hands(room_code, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_hand_player_results_user_created_at ON hand_player_results(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_stats_net_chips ON user_stats(net_chips DESC);

CREATE TABLE IF NOT EXISTS room_round_results (
  id BIGSERIAL PRIMARY KEY,
  room_code TEXT NOT NULL REFERENCES rooms(room_code) ON DELETE CASCADE,
  round_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  settled_at TIMESTAMPTZ NOT NULL,
  water_up_count INT NOT NULL,
  bankrupt_count INT NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  chips INT NOT NULL,
  rank INT NOT NULL,
  is_tied BOOLEAN NOT NULL DEFAULT FALSE,
  rank_points NUMERIC(10,1) NOT NULL,
  chip_points NUMERIC(10,1) NOT NULL,
  bankrupt_penalty NUMERIC(10,1) NOT NULL,
  champion_bonus NUMERIC(10,1) NOT NULL,
  total_points NUMERIC(10,1) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(room_code, round_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_leaderboard_stats (
  room_code TEXT NOT NULL REFERENCES rooms(room_code) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  rounds_played INT NOT NULL DEFAULT 0,
  rounds_won INT NOT NULL DEFAULT 0,
  bankrupt_count INT NOT NULL DEFAULT 0,
  total_points NUMERIC(10,1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(room_code, user_id)
);

CREATE TABLE IF NOT EXISTS room_settlement_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL REFERENCES rooms(room_code) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_settlement_entries (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES room_settlement_snapshots(snapshot_id) ON DELETE CASCADE,
  room_code TEXT NOT NULL REFERENCES rooms(room_code) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  rounds_played INT NOT NULL,
  rounds_won INT NOT NULL,
  bankrupt_count INT NOT NULL,
  total_points NUMERIC(10,1) NOT NULL,
  details_json JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_room_round_results_room_settled_at ON room_round_results(room_code, settled_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_leaderboard_stats_room_points ON room_leaderboard_stats(room_code, total_points DESC);
CREATE INDEX IF NOT EXISTS idx_room_settlement_snapshots_room_created_at ON room_settlement_snapshots(room_code, created_at DESC);
