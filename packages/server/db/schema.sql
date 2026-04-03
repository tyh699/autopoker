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
