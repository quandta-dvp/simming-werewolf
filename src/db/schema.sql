-- Schema cho Simming Werewolf
-- Chay file nay 1 lan khi setup Postgres: psql $DATABASE_URL -f src/db/schema.sql

CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  winning_faction TEXT, -- villager | wolf | third_party
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS game_players (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  faction TEXT NOT NULL,
  won BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS game_logs (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- View tien loi cho /simwolf stats va /simwolf leaderboard
CREATE OR REPLACE VIEW player_stats AS
SELECT
  user_id,
  COUNT(*) AS games_played,
  COUNT(*) FILTER (WHERE won) AS games_won,
  ROUND(100.0 * COUNT(*) FILTER (WHERE won) / NULLIF(COUNT(*), 0), 1) AS win_rate,
  COUNT(*) FILTER (WHERE faction = 'wolf') AS games_as_wolf,
  ROUND(100.0 * COUNT(*) FILTER (WHERE faction = 'wolf') / NULLIF(COUNT(*), 0), 1) AS wolf_rate
FROM game_players
GROUP BY user_id;
