const assert = require('node:assert');

// ---------------------------------------------------------------------
// Mock toan bo pg.Pool truoc khi bat ky module nao trong src/db require no,
// de gameRepository.js chay tren "DB gia" trong bo nho thay vi Postgres that.
// ---------------------------------------------------------------------
process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake_db_for_test';

const queryLog = []; // ghi lai moi cau query de kiem tra sau

const fakeDb = {
  games: [], // {id, guild_id, ...}
  game_players: [],
  game_logs: [],
  nextGameId: 1,
};

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'pg') {
    return {
      Pool: class FakePool {
        constructor() {}
        on() {}
        async query(sql, params = []) {
          queryLog.push({ sql, params });
          return fakeQueryHandler(sql, params);
        }
        async connect() {
          return {
            query: async (sql, params = []) => {
              queryLog.push({ sql, params });
              return fakeQueryHandler(sql, params);
            },
            release: () => {},
          };
        }
      },
    };
  }
  return originalRequire.apply(this, arguments);
};

function fakeQueryHandler(sql, params) {
  const s = sql.trim();

  if (s.startsWith('BEGIN') || s.startsWith('COMMIT') || s.startsWith('ROLLBACK')) {
    return { rows: [] };
  }

  if (s.startsWith('INSERT INTO games')) {
    const id = fakeDb.nextGameId++;
    fakeDb.games.push({
      id,
      guild_id: params[0], channel_id: params[1], host_id: params[2],
      player_count: params[3], day_count: params[4], winning_faction: params[5], ended_reason: params[6],
    });
    return { rows: [{ id }] };
  }

  if (s.startsWith('INSERT INTO game_players')) {
    fakeDb.game_players.push({
      game_id: params[0], user_id: params[1], role_id: params[2], faction: params[3], survived: params[4], won: params[5],
    });
    return { rows: [] };
  }

  if (s.startsWith('INSERT INTO game_logs')) {
    fakeDb.game_logs.push({ game_id: params[0], day_number: params[1], user_id: params[2], role_id: params[3], text: params[4] });
    return { rows: [] };
  }

  if (s.startsWith('SELECT * FROM player_stats WHERE user_id')) {
    const userId = params[0];
    const rows = fakeDb.game_players.filter((gp) => gp.user_id === userId);
    if (rows.length === 0) return { rows: [] };
    const gamesPlayed = rows.length;
    const gamesWon = rows.filter((r) => r.won).length;
    const gamesAsWolf = rows.filter((r) => r.faction === 'wolf').length;
    return {
      rows: [{
        user_id: userId,
        games_played: gamesPlayed,
        games_won: gamesWon,
        win_rate: Math.round((gamesWon / gamesPlayed) * 1000) / 10,
        games_as_wolf: gamesAsWolf,
        wolf_rate: Math.round((gamesAsWolf / gamesPlayed) * 1000) / 10,
      }],
    };
  }

  if (s.startsWith('SELECT * FROM player_stats WHERE games_played')) {
    const byUser = new Map();
    for (const gp of fakeDb.game_players) {
      if (!byUser.has(gp.user_id)) byUser.set(gp.user_id, []);
      byUser.get(gp.user_id).push(gp);
    }
    const rows = [...byUser.entries()].map(([userId, rs]) => ({
      user_id: userId,
      games_played: rs.length,
      games_won: rs.filter((r) => r.won).length,
      win_rate: Math.round((rs.filter((r) => r.won).length / rs.length) * 1000) / 10,
    })).sort((a, b) => b.games_won - a.games_won);
    return { rows: rows.slice(0, params[1] || 10) };
  }

  throw new Error('Fake DB không hỗ trợ query này trong test: ' + s);
}

// Bay gio moi require - se dung FakePool o tren thay vi pg that
const { saveFinishedGame, getPlayerStats, getLeaderboard } = require('../src/db/gameRepository');

async function run() {
  // ---------------------------------------------------------------------
  // Test 1: saveFinishedGame ghi dung du lieu vao games/game_players/game_logs
  // ---------------------------------------------------------------------
  {
    const game = {
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'host1',
      dayNumber: 2,
      startedAt: Date.now(),
      players: new Map([
        ['wolf1', { userId: 'wolf1', roleId: 'SOI_THUONG', faction: 'wolf', isAlive: false }],
        ['villager1', { userId: 'villager1', roleId: 'DAN_THUONG', faction: 'villager', isAlive: true }],
      ]),
      gameLog: [
        { dayNumber: 1, userId: 'wolf1', roleId: 'SOI_THUONG', text: 'bị dân làng treo cổ' },
      ],
    };

    const gameId = await saveFinishedGame(game, 'villager');
    assert.ok(gameId, 'phai tra ve gameId');
    assert.strictEqual(fakeDb.games.length, 1);
    assert.strictEqual(fakeDb.games[0].winning_faction, 'villager');
    assert.strictEqual(fakeDb.game_players.length, 2);
    const wolfRow = fakeDb.game_players.find((p) => p.user_id === 'wolf1');
    assert.strictEqual(wolfRow.won, false, 'wolf1 thua vi phe villager thang');
    const villagerRow = fakeDb.game_players.find((p) => p.user_id === 'villager1');
    assert.strictEqual(villagerRow.won, true, 'villager1 thang vi cung phe villager');
    assert.strictEqual(fakeDb.game_logs.length, 1);
    console.log('✅ saveFinishedGame OK: ghi đúng games/game_players/game_logs, tính "won" đúng theo phe');
  }

  // ---------------------------------------------------------------------
  // Test 2: saveFinishedGame cho THANG_NGO thang rieng le (khong theo phe)
  // ---------------------------------------------------------------------
  {
    const game = {
      guildId: 'g2', channelId: 'c2', hostId: 'host2', dayNumber: 1, startedAt: Date.now(),
      players: new Map([
        ['fool1', { userId: 'fool1', roleId: 'THANG_NGO', faction: 'third_party', isAlive: false }],
        ['villager2', { userId: 'villager2', roleId: 'DAN_THUONG', faction: 'villager', isAlive: true }],
      ]),
      gameLog: [],
    };
    await saveFinishedGame(game, 'FOOL');
    const foolRow = fakeDb.game_players.find((p) => p.user_id === 'fool1');
    const villagerRow = fakeDb.game_players.find((p) => p.user_id === 'villager2');
    assert.strictEqual(foolRow.won, true, 'Thằng Ngố phải thắng khi winnerFaction=FOOL');
    assert.strictEqual(villagerRow.won, false, 'người khác không thắng khi Thằng Ngố thắng');
    console.log('✅ saveFinishedGame OK: Thằng Ngố thắng riêng lẻ, không tính theo phe');
  }

  // ---------------------------------------------------------------------
  // Test 3: getPlayerStats tra ve dung so lieu tich luy qua 2 tran
  // ---------------------------------------------------------------------
  {
    const stats = await getPlayerStats('wolf1');
    assert.ok(stats);
    assert.strictEqual(stats.games_played, 1);
    assert.strictEqual(stats.games_won, 0);
    console.log('✅ getPlayerStats OK: trả về đúng thống kê tích lũy');

    const noStats = await getPlayerStats('never_played');
    assert.strictEqual(noStats, null, 'phai tra ve null neu chua choi tran nao');
    console.log('✅ getPlayerStats OK: trả về null cho người chưa từng chơi');
  }

  // ---------------------------------------------------------------------
  // Test 4: getLeaderboard sap xep theo so tran thang giam dan
  // ---------------------------------------------------------------------
  {
    const rows = await getLeaderboard(10);
    assert.ok(rows.length >= 2);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].games_won >= rows[i].games_won, 'leaderboard phai sap xep giam dan theo games_won');
    }
    console.log('✅ getLeaderboard OK: sắp xếp đúng theo số trận thắng giảm dần');
  }

  console.log('\n=== TẤT CẢ TEST GAMEREPOSITORY ĐỀU PASS ===');
}

run().finally(() => {
  Module.prototype.require = originalRequire; // don dep monkey-patch
});
