const assert = require('node:assert');
const { GameManager } = require('../src/game/GameManager');
const engine = require('../src/game/engine');
const flow = require('../src/game/flow');

function makePlayer(userId, roleId, faction, isAlive = true) {
  return {
    userId, roleId, faction, isAlive, state: {},
  };
}

// Mock client toi gian (giong integration.test.js) - chi can du de resolveAndAnnounceNight chay het,
// khong quan tam noi dung tin nhan gui di, chi quan tam game.gameLog sau khi resolve.
function createMockClient() {
  function makeChannel(channelId) {
    return {
      id: channelId,
      send: async () => ({ id: 'msg_' + Math.random().toString(36).slice(2), channelId }),
      threads: { create: async () => ({ id: 't', members: { add: async () => {} }, send: async () => ({}) }) },
      messages: { fetch: async () => { throw new Error('not found'); } },
    };
  }
  return {
    users: { fetch: async (userId) => ({ id: userId, username: `user_${userId}`, send: async () => ({}) }) },
    channels: { fetch: async (id) => makeChannel(id) },
  };
}

async function run() {
  // ---------------------------------------------------------------------
  // Case 1: Ket qua soi cua Tien Tri phai duoc ghi vao game.gameLog (de hien
  // trong bang tong ket Excel cuoi game), khong chi gui tin rieng cho Tien Tri.
  // ---------------------------------------------------------------------
  {
    const gm = new GameManager();
    const client = createMockClient();
    const guildId = 'g1';
    gm.createGame(guildId, 'chan1', 'host1');
    for (const id of ['p1', 'p2', 'p3']) gm.join(guildId, id);
    gm.setSelectedRoles(guildId, 'host1', ['TIEN_TRI', 'SOI_THUONG']);
    const game = gm.startGame(guildId, 'host1');

    const seer = [...game.players.values()].find((p) => p.roleId === 'TIEN_TRI');
    const wolf = [...game.players.values()].find((p) => p.roleId === 'SOI_THUONG');
    const villager = [...game.players.values()].find((p) => p.roleId === 'DAN_THUONG');

    gm.submitWolfVote(game, wolf.userId, villager.userId);
    gm.submitSeerTarget(game, seer.userId, wolf.userId); // soi trung Soi -> ky vong ra "LA Soi"

    await flow.resolveAndAnnounceNight(client, gm, game);

    const seerLogEntry = game.gameLog.find((e) => e.roleId === 'TIEN_TRI' && e.text.startsWith('soi ra'));
    assert.ok(seerLogEntry, 'Phai co dong log ket qua soi (khong chi log lua chon soi ai)');
    assert.match(seerLogEntry.text, /LÀ Sói/, 'Soi trung Soi thi ket qua phai ghi ro LA Soi');
    console.log('✅ OK: kết quả soi (LÀ/KHÔNG PHẢI Sói) được ghi vào bảng tổng kết, không chỉ log lựa chọn soi ai');
  }

  // ---------------------------------------------------------------------
  // Case 2: Bao Ve chi chan duoc chet do Soi can - neu nguoi duoc bao ve bi
  // Tho San ban theo (cascade khi Tho San chet), ho van chet binh thuong.
  // ---------------------------------------------------------------------
  {
    const game = {
      players: new Map(), dayNumber: 1, cursedUserIds: new Set(), wolfCubBonusPending: false,
    };
    game.players.set('guard1', makePlayer('guard1', 'BAO_VE', 'villager'));
    game.players.set('hunter1', makePlayer('hunter1', 'THO_SAN', 'villager'));
    game.players.get('hunter1').state.hunterTarget = 'guarded1'; // Tho San da chon truoc muc tieu nay
    game.players.set('guarded1', makePlayer('guarded1', 'DAN_THUONG', 'villager'));
    game.players.set('wolf1', makePlayer('wolf1', 'SOI_THUONG', 'wolf'));

    game.night = {
      wolfVotes: new Map([['wolf1', 'hunter1']]), // dem nay Soi can Tho San, khong phai nguoi duoc bao ve
      guardTarget: 'guarded1', // Bao Ve dang bao ve guarded1 (nhung guarded1 khong bi Soi can dem nay)
      caveTarget: undefined,
      witchAction: null,
      seerTarget: null,
      curseTarget: null,
    };

    const result = engine.resolveNight(game);

    assert.strictEqual(game.players.get('hunter1').isAlive, false, 'Tho San phai chet vi bi Soi can (khong duoc bao ve nguoi nay)');
    assert.strictEqual(game.players.get('guarded1').isAlive, false, 'Nguoi duoc Bao Ve BAO VE van phai chet theo khi bi Tho San ban theo — Bao Ve chi chan duoc chet do Soi can');
    assert.ok(
      result.deaths.some((d) => d.userId === 'guarded1' && d.cause === 'hunter_shot'),
      'Cai chet cua nguoi duoc bao ve phai duoc ghi nhan dung nguyen nhan la hunter_shot, khong phai wolf_bite',
    );
    console.log('✅ OK: Bảo Vệ không chặn được người bị Thợ Săn bắn theo (Bảo Vệ chỉ chặn chết do Sói cắn)');
  }

  console.log('\n=== TẤT CẢ TEST ĐỀU PASS ===');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
