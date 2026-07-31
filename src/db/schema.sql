-- Schema cho Simming Werewolf
-- Chay file nay 1 lan khi setup Postgres: psql $DATABASE_URL -f src/db/schema.sql
-- An toan chay lai nhieu lan (idempotent).

-- =========================================================================
-- NHOM A — ARCHIVAL: luu ket qua sau khi 1 van KET THUC, dung cho
-- /simwolf stats, /simwolf leaderboard, va bang log cuoi game.
-- =========================================================================

CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  player_count INTEGER, -- so nguoi choi khi start, tien cho thong ke sau nay
  day_count INTEGER, -- tong so ngay van keo dai toi khi ket thuc
  winning_faction TEXT CHECK (winning_faction IN ('villager', 'wolf', 'third_party')),
  ended_reason TEXT, -- faction_win | fool_win | cancelled | v.v.
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS game_players (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  faction TEXT NOT NULL CHECK (faction IN ('villager', 'wolf', 'third_party')),
  survived BOOLEAN NOT NULL DEFAULT true, -- con song luc game ket thuc
  won BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (game_id, user_id)
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

CREATE INDEX IF NOT EXISTS idx_game_players_game_id ON game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_game_players_user_id ON game_players(user_id);
CREATE INDEX IF NOT EXISTS idx_game_logs_game_id ON game_logs(game_id);

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

-- =========================================================================
-- NHOM B — LIVE STATE: snapshot toan bo game dang chay (RAM) de restart
-- khong mat tien do. 1 row / 1 guild (khop voi rule "moi guild 1 game").
-- Luu duoi dang JSONB thay vi chuan hoa tung cot, vi cau truc game.night
-- (Map/Set long nhau: wolfVotes, submittedUserIds, promptMessages...) rat
-- linh hoat va thay doi theo tung buoc phat trien role — chuan hoa se de
-- lech logic voi GameManager.js. state_json la ban serialize truc tiep
-- cua object `game` (Map -> object, Set -> array) tai thoi diem luu.
-- =========================================================================

CREATE TABLE IF NOT EXISTS active_games (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('LOBBY', 'RUNNING', 'ENDED')),
  state_json JSONB NOT NULL, -- serialize cua toan bo object `game`
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- playerGuildMap (GameManager) - can de tra DM/thread action ve dung game sau restart
CREATE TABLE IF NOT EXISTS active_game_players (
  user_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES active_games(guild_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_active_game_players_guild_id ON active_game_players(guild_id);
