const { pool } = require('./pool');

/**
 * GameStore: serialize/deserialize object `game` (co chua Map va Set long nhau)
 * ra/vao JSONB trong bang active_games, de GameManager phuc hoi duoc state
 * sau khi bot restart.
 *
 * Thiet ke:
 * - state_json luu ban serialize TRUC TIEP cua object `game`, khong chuan hoa
 *   tung field ra cot rieng (xem ly do trong schema.sql).
 * - Moi ham public (save/load/loadAll/delete) deu tu bao ve bang try/catch va
 *   kiem tra `pool` - neu chua cau hinh DATABASE_URL thi tro thanh no-op an toan,
 *   khong lam crash hoac lam gian doan luong game dang choi trong RAM.
 * - save() la "fire-and-forget" theo thiet ke cua GameManager (khong await),
 *   nen loi ghi DB se chi log ra console, khong nem exception len tren.
 */
class GameStore {
  constructor(dbPool = pool) {
    this.pool = dbPool;
  }

  get enabled() {
    return !!this.pool;
  }

  // -------------------------------------------------------------------
  // Serialize: object `game` (co Map/Set) -> plain object (JSON-safe)
  // -------------------------------------------------------------------

  static serializeGame(game) {
    return {
      guildId: game.guildId,
      channelId: game.channelId,
      hostId: game.hostId,
      status: game.status,
      players: mapToObject(game.players, serializePlayer),
      selectedRoles: game.selectedRoles,
      dayNumber: game.dayNumber,
      phase: game.phase,
      night: serializeNight(game.night),
      dayVotes: game.dayVotes ? mapToObject(game.dayVotes) : null,
      cursedUserIds: game.cursedUserIds ? [...game.cursedUserIds] : [],
      couple: game.couple || null,
      wolfCubBonusPending: game.wolfCubBonusPending,
      wolfCubBonusUsed: game.wolfCubBonusUsed,
      threads: game.threads || {},
      panelChannelId: game.panelChannelId,
      panelMessageId: game.panelMessageId,
      startedAt: game.startedAt,
      createdAt: game.createdAt,
      gameLog: game.gameLog || [],
    };
  }

  // -------------------------------------------------------------------
  // Deserialize: plain object (tu JSONB) -> object `game` (khoi phuc Map/Set)
  // -------------------------------------------------------------------

  static deserializeGame(data) {
    return {
      guildId: data.guildId,
      channelId: data.channelId,
      hostId: data.hostId,
      status: data.status,
      players: objectToMap(data.players, deserializePlayer),
      selectedRoles: data.selectedRoles,
      dayNumber: data.dayNumber,
      phase: data.phase,
      night: deserializeNight(data.night),
      dayVotes: data.dayVotes ? objectToMap(data.dayVotes) : null,
      cursedUserIds: new Set(data.cursedUserIds || []),
      couple: data.couple || null,
      wolfCubBonusPending: !!data.wolfCubBonusPending,
      wolfCubBonusUsed: !!data.wolfCubBonusUsed,
      threads: data.threads || {},
      panelChannelId: data.panelChannelId ?? null,
      panelMessageId: data.panelMessageId ?? null,
      startedAt: data.startedAt ?? null,
      createdAt: data.createdAt ?? Date.now(),
      gameLog: data.gameLog || [],
    };
  }

  // -------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------

  /**
   * Ghi (upsert) toan bo snapshot game hien tai. Fire-and-forget theo thiet ke:
   * goi noi khong can await, loi se chi log ra console.
   */
  async save(game) {
    if (!this.enabled) return;
    try {
      const stateJson = GameStore.serializeGame(game);
      await this.pool.query(
        `INSERT INTO active_games (guild_id, channel_id, host_id, status, state_json, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (guild_id) DO UPDATE SET
           channel_id = EXCLUDED.channel_id,
           host_id = EXCLUDED.host_id,
           status = EXCLUDED.status,
           state_json = EXCLUDED.state_json,
           updated_at = now()`,
        [game.guildId, game.channelId, game.hostId, game.status, JSON.stringify(stateJson)]
      );
      // dong bo playerGuildMap (dung khi tra cuu game tu DM sau khi bot restart)
      const playerIds = [...game.players.keys()];
      if (playerIds.length > 0) {
        await this.pool.query(
          `INSERT INTO active_game_players (user_id, guild_id)
           SELECT unnest($1::text[]), $2
           ON CONFLICT (user_id) DO UPDATE SET guild_id = EXCLUDED.guild_id`,
          [playerIds, game.guildId]
        );
      }
    } catch (err) {
      console.error('[GameStore.save] Lỗi lưu game vào DB (guild ' + game.guildId + '):', err.message);
    }
  }

  /** Xoa han snapshot cua 1 guild (khi game cancel hoac ket thuc). */
  async delete(guildId) {
    if (!this.enabled) return;
    try {
      await this.pool.query(`DELETE FROM active_games WHERE guild_id = $1`, [guildId]);
      // active_game_players tu xoa theo qua ON DELETE CASCADE
    } catch (err) {
      console.error('[GameStore.delete] Lỗi xóa game khỏi DB (guild ' + guildId + '):', err.message);
    }
  }

  /** Load 1 game theo guildId. Tra ve null neu khong co hoac loi. */
  async load(guildId) {
    if (!this.enabled) return null;
    try {
      const res = await this.pool.query(`SELECT state_json FROM active_games WHERE guild_id = $1`, [guildId]);
      if (res.rows.length === 0) return null;
      return GameStore.deserializeGame(res.rows[0].state_json);
    } catch (err) {
      console.error('[GameStore.load] Lỗi đọc game từ DB (guild ' + guildId + '):', err.message);
      return null;
    }
  }

  /** Load toan bo game dang active (dung luc bot khoi dong). Tra ve mang [] neu loi. */
  async loadAll() {
    if (!this.enabled) return [];
    try {
      const res = await this.pool.query(`SELECT state_json FROM active_games`);
      return res.rows.map((row) => GameStore.deserializeGame(row.state_json));
    } catch (err) {
      console.error('[GameStore.loadAll] Lỗi đọc danh sách game từ DB:', err.message);
      return [];
    }
  }
}

// ===========================================================================
// Helpers serialize/deserialize
// ===========================================================================

function mapToObject(map, valueFn) {
  const obj = {};
  for (const [key, value] of map.entries()) {
    obj[key] = valueFn ? valueFn(value) : value;
  }
  return obj;
}

function objectToMap(obj, valueFn) {
  const map = new Map();
  if (!obj) return map;
  for (const key of Object.keys(obj)) {
    map.set(key, valueFn ? valueFn(obj[key]) : obj[key]);
  }
  return map;
}

function serializePlayer(player) {
  // player.state la plain object thuan (khong co Map/Set ben trong theo GameManager.js hien tai)
  return {
    userId: player.userId,
    roleId: player.roleId,
    faction: player.faction,
    isAlive: player.isAlive,
    state: player.state || {},
  };
}

function deserializePlayer(data) {
  return {
    userId: data.userId,
    roleId: data.roleId,
    faction: data.faction,
    isAlive: data.isAlive,
    state: data.state || {},
  };
}

function serializeNight(night) {
  if (!night) return null;
  return {
    wolfVotes: night.wolfVotes ? mapToObject(night.wolfVotes) : {},
    curseTarget: night.curseTarget ?? null,
    guardTarget: night.guardTarget,
    caveTarget: night.caveTarget,
    witchAction: night.witchAction ?? null,
    seerTarget: night.seerTarget,
    cupidTargets: night.cupidTargets ?? null,
    submittedUserIds: night.submittedUserIds ? [...night.submittedUserIds] : [],
    promptMessages: night.promptMessages || [],
  };
}

function deserializeNight(data) {
  if (!data) return null;
  return {
    wolfVotes: objectToMap(data.wolfVotes),
    curseTarget: data.curseTarget ?? null,
    guardTarget: data.guardTarget,
    caveTarget: data.caveTarget,
    witchAction: data.witchAction ?? null,
    seerTarget: data.seerTarget,
    cupidTargets: data.cupidTargets ?? undefined,
    submittedUserIds: new Set(data.submittedUserIds || []),
    promptMessages: data.promptMessages || [],
  };
}

module.exports = { GameStore };
