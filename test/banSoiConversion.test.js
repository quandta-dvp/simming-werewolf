const assert = require('node:assert');
const { GameManager } = require('../src/game/GameManager');
const { FACTION } = require('../src/game/constants');

function makePlayer(userId, roleId, faction, isAlive = true) {
  return {
    userId, roleId, faction, isAlive, state: {},
  };
}

function run() {
  const gm = new GameManager();

  // ---------------------------------------------------------------------
  // Case 1: threadGroupOf phai gom Ban Soi DA HOA SOI vao WOLVES, nhung Ban Soi
  // CHUA bi can (van la Dan) thi khong duoc gom vao thread nao ca.
  // ---------------------------------------------------------------------
  assert.strictEqual(GameManager.threadGroupOf('BAN_SOI', FACTION.WOLF), 'WOLVES', 'Ban Soi da hoa Soi phai thuoc thread WOLVES');
  assert.strictEqual(GameManager.threadGroupOf('BAN_SOI', FACTION.VILLAGER), null, 'Ban Soi chua bi can thi khong co thread rieng');
  console.log('✅ OK: threadGroupOf gom đúng Bán Sói đã hóa Sói vào WOLVES, chưa hóa thì không có thread');

  // ---------------------------------------------------------------------
  // Case 2: getNightActors phai tinh Ban Soi da hoa Soi la 1 actor dem nay (du
  // roleId cua ho khong doi va BAN_SOI.hasNightAction = false), va isNightComplete
  // phai doi ho vote xong moi coi la du - dac biet khi ho la SOI DUY NHAT con song.
  // ---------------------------------------------------------------------
  {
    const game = {
      players: new Map(), dayNumber: 2, cursedUserIds: new Set(), wolfCubBonusPending: false,
    };
    game.players.set('villager1', makePlayer('villager1', 'DAN_THUONG', FACTION.VILLAGER));
    game.players.set('banSoi1', makePlayer('banSoi1', 'BAN_SOI', FACTION.WOLF)); // da bi can dem truoc, gio la Soi duy nhat con song
    gm.beginNightState(game);

    const actors = gm.getNightActors(game);
    assert.ok(actors.some((p) => p.userId === 'banSoi1'), 'Ban Soi da hoa Soi phai duoc tinh la night actor');
    assert.strictEqual(gm.isNightComplete(game), false, 'Dem chua the hoan tat khi Soi duy nhat (Ban Soi) chua vote can ai');

    gm.submitWolfVote(game, 'banSoi1', 'villager1');
    assert.strictEqual(gm.isNightComplete(game), true, 'Sau khi Ban Soi (Soi duy nhat) vote xong, dem phai duoc coi la hoan tat');
    console.log('✅ OK: Bán Sói đã hóa Sói được tính là actor bắt buộc và có thể tự vote cắn khi là Sói duy nhất còn sống');
  }

  console.log('\n=== TẤT CẢ TEST BÁN SÓI ĐỀU PASS ===');
}

run();
