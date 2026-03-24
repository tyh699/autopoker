CREATE TABLE IF NOT EXISTS rooms (
  room_code TEXT PRIMARY KEY,
  host_player_id TEXT NOT NULL,
  config_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_players (
  id BIGSERIAL PRIMARY KEY,
  room_code TEXT NOT NULL REFERENCES rooms(room_code) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
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
  target_player_id TEXT NOT NULL,
  before_value INT NOT NULL,
  after_value INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL REFERENCES rooms(room_code) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

