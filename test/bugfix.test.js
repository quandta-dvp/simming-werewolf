const assert = require('node:assert');
const { GameManager } = require('../src/game/GameManager');
const engine = require('../src/game/engine');

function makePlayer(userId, roleId, faction, isAlive = true) {
  return { userId, roleId, faction, isAlive, state: {} };
}

function run() {
  const gm = new GameManager();

  // ---------------------------------------------------------------------
  // Bug 1: Cave chi duoc ngu 1 nguoi / dem
  // ---------------------------------------------------------------------
  {
    const game = { players: new Map(), night: null };
    game.players.set('cave1', makePlayer('cave1', 'CAVE', 'villager'));
    game.players.set('p1', makePlayer('p1', 'DAN_THUONG', 'villager'));
    game.players.set('p2', makePlayer('p2', 'DAN_THUONG', 'villager'));
    game.night = { caveTarget: undefined, submittedUserIds: new Set() };

    gm.submitCaveTarget(game, 'cave1', 'p1');
    assert.strictEqual(game.night.caveTarget, 'p1');

    let threw = false;
    try {
      gm.submitCaveTarget(game, 'cave1', 'p2'); // thu ngu them 1 nguoi nua cung dem
    } catch (err) {
      threw = true;
      assert.match(err.message, /đã chọn/);
    }
    assert.strictEqual(threw, true, 'Cave phai bi chan khi chon nguoi thu 2 trong cung 1 dem');
    console.log('✅ Bug 1 OK: Cave không thể ngủ 2 người trong cùng 1 đêm');
  }

  // ---------------------------------------------------------------------
  // Bug 3: Vote phai dat qua ban so nguoi CON SONG moi duoc treo
  // ---------------------------------------------------------------------
  {
    // Case A: hoa phieu -> khong treo ai
    const gameTie = { players: new Map(), dayVotes: new Map() };
    for (const id of ['a', 'b', 'c', 'd']) gameTie.players.set(id, makePlayer(id, 'DAN_THUONG', 'villager'));
    gameTie.dayVotes.set('a', 'c'); // a vote c
    gameTie.dayVotes.set('b', 'd'); // b vote d
    gameTie.dayVotes.set('c', 'c');
    gameTie.dayVotes.set('d', 'd');
    const resultTie = engine.resolveDayVote(gameTie);
    assert.strictEqual(resultTie.lynchedUserId, null);
    assert.strictEqual(resultTie.tie, true);
    console.log('✅ Bug 3a OK: Hòa phiếu (2-2) → không treo ai');

    // Case B: 1 nguoi duoc nhieu phieu nhat nhung KHONG qua ban (2/5 <= 50%)
    const gameNotEnough = { players: new Map(), dayVotes: new Map() };
    for (const id of ['a', 'b', 'c', 'd', 'e']) gameNotEnough.players.set(id, makePlayer(id, 'DAN_THUONG', 'villager'));
    gameNotEnough.dayVotes.set('a', 'e'); // 2 phieu cho e
    gameNotEnough.dayVotes.set('b', 'e');
    gameNotEnough.dayVotes.set('c', null); // khong treo ai
    gameNotEnough.dayVotes.set('d', null);
    gameNotEnough.dayVotes.set('e', null);
    const resultNotEnough = engine.resolveDayVote(gameNotEnough);
    assert.strictEqual(resultNotEnough.lynchedUserId, null, 'khong duoc treo khi chi co 2/5 phieu (khong qua ban)');
    assert.strictEqual(resultNotEnough.notEnough, true);
    console.log('✅ Bug 3b OK: 2/5 phiếu (không quá bán) → không treo ai (đây là bug gốc: trước đây vẫn bị treo)');

    // Case C: dat qua ban (3/5 > 50%) -> treo dung nguoi
    const gameEnough = { players: new Map(), dayVotes: new Map() };
    for (const id of ['a', 'b', 'c', 'd', 'e']) gameEnough.players.set(id, makePlayer(id, 'DAN_THUONG', 'villager'));
    gameEnough.dayVotes.set('a', 'e');
    gameEnough.dayVotes.set('b', 'e');
    gameEnough.dayVotes.set('c', 'e');
    gameEnough.dayVotes.set('d', null);
    gameEnough.dayVotes.set('e', null);
    const resultEnough = engine.resolveDayVote(gameEnough);
    assert.strictEqual(resultEnough.lynchedUserId, 'e', 'phai treo e khi dat 3/5 (qua ban)');
    console.log('✅ Bug 3c OK: 3/5 phiếu (quá bán) → treo đúng người');
  }

  console.log('\n=== TẤT CẢ TEST BUGFIX ĐỀU PASS ===');
}

run();
