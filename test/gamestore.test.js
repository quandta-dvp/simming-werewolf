const assert = require('node:assert');
const { GameStore } = require('../src/db/GameStore');
const { GameManager } = require('../src/game/GameManager');

async function run() {
  // ---------------------------------------------------------------------
  // Test 1: round-trip serialize -> JSON.stringify -> JSON.parse -> deserialize
  // phai giu nguyen toan bo Map/Set long nhau, khong mat du lieu.
  // ---------------------------------------------------------------------
  {
    const original = {
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'host1',
      status: 'RUNNING',
      players: new Map([
        ['p1', { userId: 'p1', roleId: 'SOI_THUONG', faction: 'wolf', isAlive: true, state: { lastGuardTarget: 'p2' } }],
        ['p2', { userId: 'p2', roleId: 'BAO_VE', faction: 'villager', isAlive: false, state: {} }],
      ]),
      selectedRoles: ['SOI_THUONG', 'BAO_VE', 'DAN_THUONG'],
      dayNumber: 2,
      phase: 'NIGHT',
      night: {
        wolfVotes: new Map([['p1', 'p2']]),
        curseTarget: null,
        guardTarget: 'p2',
        caveTarget: undefined,
        witchAction: { type: 'heal', targetId: 'p2' },
        seerTarget: 'p1',
        submittedUserIds: new Set(['p1', 'p2']),
        promptMessages: [{ channelId: 'c1', messageId: 'm1' }],
      },
      dayVotes: new Map([['p1', 'p2']]),
      cursedUserIds: new Set(['p2']),
      wolfCubBonusPending: true,
      wolfCubBonusUsed: false,
      threads: { TIEN_TRI: 't1', WOLVES: 't2' },
      panelChannelId: 'c1',
      panelMessageId: 'm2',
      startedAt: 1700000000000,
      createdAt: 1699999999999,
    };

    // mo phong dung 1 vong luu/doc that: serialize -> JSON string -> parse lai -> deserialize
    const serialized = GameStore.serializeGame(original);
    const roundTripped = JSON.parse(JSON.stringify(serialized));
    const restored = GameStore.deserializeGame(roundTripped);

    assert.strictEqual(restored.guildId, 'g1');
    assert.strictEqual(restored.dayNumber, 2);
    assert.ok(restored.players instanceof Map, 'players phai la Map sau deserialize');
    assert.strictEqual(restored.players.size, 2);
    assert.strictEqual(restored.players.get('p1').roleId, 'SOI_THUONG');
    assert.strictEqual(restored.players.get('p1').state.lastGuardTarget, 'p2');
    assert.strictEqual(restored.players.get('p2').isAlive, false);

    assert.ok(restored.night.wolfVotes instanceof Map, 'night.wolfVotes phai la Map');
    assert.strictEqual(restored.night.wolfVotes.get('p1'), 'p2');
    assert.ok(restored.night.submittedUserIds instanceof Set, 'night.submittedUserIds phai la Set');
    assert.strictEqual(restored.night.submittedUserIds.size, 2);
    assert.ok(restored.night.submittedUserIds.has('p1'));
    assert.deepStrictEqual(restored.night.witchAction, { type: 'heal', targetId: 'p2' });

    assert.ok(restored.dayVotes instanceof Map);
    assert.strictEqual(restored.dayVotes.get('p1'), 'p2');
    assert.ok(restored.cursedUserIds instanceof Set);
    assert.ok(restored.cursedUserIds.has('p2'));
    assert.strictEqual(restored.wolfCubBonusPending, true);
    assert.deepStrictEqual(restored.threads, { TIEN_TRI: 't1', WOLVES: 't2' });

    console.log('✅ GameStore round-trip OK: Map/Set lồng nhau được khôi phục đúng sau serialize→JSON→deserialize');
  }

  // ---------------------------------------------------------------------
  // Test 2: GameStore.save() khi disabled (khong co pool) phai la no-op an toan
  // ---------------------------------------------------------------------
  {
    const store = new GameStore(null);
    assert.strictEqual(store.enabled, false);
    // khong duoc throw
    store.save({ guildId: 'g1', players: new Map() });
    store.delete('g1');
    console.log('✅ GameStore no-op khi chưa cấu hình DATABASE_URL OK (không throw)');
  }

  // ---------------------------------------------------------------------
  // Test 3: GameManager voi mock store - moi lan mutate state phai goi save()
  // ---------------------------------------------------------------------
  {
    const savedSnapshots = [];
    const mockStore = {
      enabled: true,
      save: async (game) => {
        savedSnapshots.push(GameStore.serializeGame(game));
      },
      delete: async () => {},
    };

    const gm = new GameManager(mockStore);
    gm.createGame('g2', 'chan2', 'host2');
    assert.strictEqual(savedSnapshots.length, 1, 'createGame phai goi save 1 lan');

    gm.join('g2', 'p1');
    gm.join('g2', 'p2');
    gm.join('g2', 'p3');
    assert.strictEqual(savedSnapshots.length, 4, 'moi lan join phai goi save');

    const lastSnapshot = savedSnapshots[savedSnapshots.length - 1];
    assert.strictEqual(Object.keys(lastSnapshot.players).length, 3);

    console.log('✅ GameManager tự động gọi store.save() sau mỗi lần mutate state OK');
  }

  // ---------------------------------------------------------------------
  // Test 4: mo phong RESTART BOT - GameManager cu bi "huy" (mat RAM), tao
  // GameManager MOI va load lai tu "DB" (mock) - state phai khop 100%.
  // ---------------------------------------------------------------------
  {
    // gia lap 1 "bang DB" đon gian trong bo nho cho mock store
    const fakeTable = new Map(); // guildId -> stateJson (da qua JSON round-trip)
    const mockStore = {
      enabled: true,
      save: async (game) => {
        const serialized = GameStore.serializeGame(game);
        fakeTable.set(game.guildId, JSON.parse(JSON.stringify(serialized))); // mo phong JSONB that su
      },
      delete: async (guildId) => {
        fakeTable.delete(guildId);
      },
      loadAll: async () => {
        return [...fakeTable.values()].map((data) => GameStore.deserializeGame(data));
      },
    };

    // --- Truoc restart: tao game, co nguoi choi, vao dem 1, co wolf vote ---
    const gmBefore = new GameManager(mockStore);
    gmBefore.createGame('g3', 'chan3', 'hostA');
    gmBefore.join('g3', 'wolf1');
    gmBefore.join('g3', 'villager1');
    gmBefore.join('g3', 'villager2');
    const gameBefore = gmBefore.getGame('g3');
    gameBefore.status = 'RUNNING';
    gameBefore.dayNumber = 1;
    gameBefore.phase = 'NIGHT';
    gmBefore.beginNightState(gameBefore);
    gameBefore.players.get('wolf1').roleId = 'SOI_THUONG';
    gameBefore.players.get('wolf1').faction = 'wolf';
    gameBefore.players.get('villager1').roleId = 'DAN_THUONG';
    gameBefore.players.get('villager1').faction = 'villager';
    gmBefore.submitWolfVote(gameBefore, 'wolf1', 'villager1');

    // --- Mo phong RESTART: tao GameManager HOAN TOAN MOI (RAM trong), load tu "DB" ---
    const gmAfter = new GameManager(mockStore);
    const restoredGames = await mockStore.loadAll();
    for (const game of restoredGames) {
      gmAfter.games.set(game.guildId, game);
      for (const userId of game.players.keys()) gmAfter.playerGuildMap.set(userId, game.guildId);
    }

    const restoredGame = gmAfter.getGame('g3');
    assert.ok(restoredGame, 'phai khoi phuc duoc game g3 sau restart');
    assert.strictEqual(restoredGame.status, 'RUNNING');
    assert.strictEqual(restoredGame.dayNumber, 1);
    assert.strictEqual(restoredGame.phase, 'NIGHT');
    assert.strictEqual(restoredGame.players.size, 3);
    assert.strictEqual(restoredGame.players.get('wolf1').roleId, 'SOI_THUONG');
    assert.ok(restoredGame.night.wolfVotes instanceof Map);
    assert.strictEqual(restoredGame.night.wolfVotes.get('wolf1'), 'villager1');
    assert.ok(restoredGame.night.submittedUserIds.has('wolf1'));

    // playerGuildMap cung phai duoc khoi phuc, de tra DM/thread ve dung game
    assert.strictEqual(gmAfter.getGameByPlayer('wolf1').guildId, 'g3');
    assert.strictEqual(gmAfter.getGameByPlayer('villager1').guildId, 'g3');

    // game sau restart phai TIEP TUC dung binh thuong - vd wolf vote lai (doi muc tieu)
    gmAfter.submitWolfVote(restoredGame, 'wolf1', 'villager2');
    assert.strictEqual(restoredGame.night.wolfVotes.get('wolf1'), 'villager2');

    console.log('✅ Mô phỏng restart OK: state RUNNING (day 1, night, wolf votes, playerGuildMap) được khôi phục đúng và game chơi tiếp được bình thường');
  }

  console.log('\n=== TẤT CẢ TEST GAMESTORE ĐỀU PASS ===');
}

run();
