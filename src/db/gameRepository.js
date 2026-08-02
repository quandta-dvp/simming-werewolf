const { pool } = require('./pool');

/**
 * Ghi lai 1 tran DA KET THUC vao Postgres (bang games/game_players/game_logs)
 * de phuc vu /simwolf stats va /simwolf leaderboard (qua view player_stats).
 *
 * Khac voi GameStore (luu SNAPSHOT dang chay de restart khong mat tien do),
 * ham nay chi chay 1 LAN DUY NHAT luc endGame, ghi ket qua CUOI CUNG.
 *
 * An toan: neu chua cau hinh DATABASE_URL hoac co loi ghi DB, chi log ra
 * console va tra ve null - khong lam gian doan flow ket thuc game (embed/thread
 * van phai gui cho nguoi choi du DB co loi hay khong).
 *
 * @param {object} game - object game (da co history day/night qua game.gameLog)
 * @param {string} winnerFaction - 'villager' | 'wolf' | 'FOOL' | 'LOVERS'
 * @returns {Promise<number|null>} id cua row trong bang games, hoac null neu khong luu duoc
 */
async function saveFinishedGame(game, winnerFaction) {
  if (!pool) {
    console.warn('[gameRepository] Chưa cấu hình DATABASE_URL — không lưu kết quả trận vào DB.');
    return null;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const players = [...game.players.values()];
    // FOOL va LOVERS la 2 nhanh rieng cua third_party trong DB (winning_faction chi co 3 gia tri: villager/wolf/third_party)
    const winningFactionDb = (winnerFaction === 'FOOL' || winnerFaction === 'LOVERS') ? 'third_party' : winnerFaction;

    const gameRes = await client.query(
      `INSERT INTO games (guild_id, channel_id, host_id, player_count, day_count, winning_faction, ended_reason, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), now())
       RETURNING id`,
      [
        game.guildId,
        game.channelId,
        game.hostId,
        players.length,
        game.dayNumber,
        winningFactionDb,
        winnerFaction === 'FOOL' ? 'fool_win' : winnerFaction === 'LOVERS' ? 'lovers_win' : 'faction_win',
        game.startedAt || game.createdAt,
      ]
    );
    const gameId = gameRes.rows[0].id;

    for (const p of players) {
      // "thang" duoc tinh theo phe (hoac Thang Ngo tu treo co thang rieng le)
      const won = winnerFaction === 'FOOL' ? p.roleId === 'THANG_NGO'
        : winnerFaction === 'LOVERS' ? !!(game.couple && game.couple.includes(p.userId))
          : p.faction === winnerFaction;
      await client.query(
        `INSERT INTO game_players (game_id, user_id, role_id, faction, survived, won)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (game_id, user_id) DO NOTHING`,
        [gameId, p.userId, p.roleId, p.faction, p.isAlive, won]
      );
    }

    for (const entry of game.gameLog || []) {
      const p = game.players.get(entry.userId);
      await client.query(
        `INSERT INTO game_logs (game_id, day_number, user_id, role_id, text)
         VALUES ($1, $2, $3, $4, $5)`,
        [gameId, entry.dayNumber, entry.userId, entry.roleId || (p ? p.roleId : null), entry.text]
      );
    }

    await client.query('COMMIT');
    return gameId;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[gameRepository.saveFinishedGame] Lỗi lưu kết quả trận vào DB:', err.message);
    return null;
  } finally {
    client.release();
  }
}

/** Lay thong ke 1 nguoi choi tu view player_stats. Tra ve null neu chua tung choi tran nao hoac loi DB. */
async function getPlayerStats(userId) {
  if (!pool) return null;
  try {
    const res = await pool.query(`SELECT * FROM player_stats WHERE user_id = $1`, [userId]);
    return res.rows[0] || null;
  } catch (err) {
    console.error('[gameRepository.getPlayerStats] Lỗi đọc player_stats:', err.message);
    return null;
  }
}

/** Lay top N nguoi choi theo so tran thang (uu tien) va ti le thang, chi tinh nguoi choi >= minGames tran. */
async function getLeaderboard(limit = 10, minGames = 1) {
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT * FROM player_stats WHERE games_played >= $1 ORDER BY games_won DESC, win_rate DESC NULLS LAST LIMIT $2`,
      [minGames, limit]
    );
    return res.rows;
  } catch (err) {
    console.error('[gameRepository.getLeaderboard] Lỗi đọc leaderboard:', err.message);
    return [];
  }
}

module.exports = { saveFinishedGame, getPlayerStats, getLeaderboard };