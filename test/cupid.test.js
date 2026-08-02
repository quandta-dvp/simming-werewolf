const assert = require('node:assert');
const { GameManager } = require('../src/game/GameManager');
const engine = require('../src/game/engine');

function makePlayer(userId, roleId, faction, isAlive = true) {
  return {
    userId, roleId, faction, isAlive, state: {},
  };
}

function run() {
  const gm = new GameManager();

  // ---------------------------------------------------------------------
  // Case 1: Cupid ghep cap thanh cong dem 1, sau do 1 nguoi chet -> nguoi
  // con lai chet theo (heartbreak). Cap khac phe -> LOVERS thang khi chi
  // con lai dung 2 nguoi.
  // ---------------------------------------------------------------------
  {
    const game = {
      players: new Map(), dayNumber: 1, night: null, couple: null, cursedUserIds: new Set(), wolfCubBonusPending: false,
    };
    game.players.set('cupid1', makePlayer('cupid1', 'CUPID', 'villager'));
    game.players.set('villager1', makePlayer('villager1', 'DAN_THUONG', 'villager')); // se duoc ghep cap
    game.players.set('wolf1', makePlayer('wolf1', 'SOI_THUONG', 'wolf')); // se duoc ghep cap - khac phe
    game.players.set('wolf2', makePlayer('wolf2', 'SOI_THUONG', 'wolf'));
    gm.beginNightState(game);

    gm.submitCupidTargets(game, 'cupid1', ['villager1', 'wolf1']);
    assert.deepStrictEqual(game.night.cupidTargets, ['villager1', 'wolf1']);

    const result1 = engine.resolveNight(game);
    assert.deepStrictEqual(game.couple, ['villager1', 'wolf1'], 'Cupid phai ghep dung cap');
    console.log('✅ Cupid OK: ghép cặp thành công đêm 1');

    // Villager1 (khong phai Soi) bi Soi can chet ngay dem sau (mo phong truc tiep qua resolveDayVote de test heartbreak)
    game.dayVotes = new Map();
    game.players.get('cupid1').isAlive = true;
    for (const id of ['cupid1', 'wolf2', 'wolf1']) game.dayVotes.set(id, 'villager1'); // 3/4 alive > 50% -> du de treo
    game.dayVotes.set('villager1', null);
    const voteResult = engine.resolveDayVote(game);
    assert.strictEqual(voteResult.lynchedUserId, 'villager1');
    assert.strictEqual(game.players.get('villager1').isAlive, false);
    assert.strictEqual(game.players.get('wolf1').isAlive, false, 'wolf1 phai chet theo vi la cap voi villager1 (heartbreak)');
    console.log('✅ Cupid OK: 1 người trong cặp chết → người còn lại chết theo (heartbreak)');
  }

  // ---------------------------------------------------------------------
  // Case 2: Cave ngu trung Cupid dung dem dau tien -> khong ghep duoc cap
  // ---------------------------------------------------------------------
  {
    const game = {
      players: new Map(), dayNumber: 1, night: null, couple: null, cursedUserIds: new Set(), wolfCubBonusPending: false,
    };
    game.players.set('cupid1', makePlayer('cupid1', 'CUPID', 'villager'));
    game.players.set('cave1', makePlayer('cave1', 'CAVE', 'villager'));
    game.players.set('p1', makePlayer('p1', 'DAN_THUONG', 'villager'));
    game.players.set('p2', makePlayer('p2', 'DAN_THUONG', 'villager'));
    gm.beginNightState(game);

    gm.submitCupidTargets(game, 'cupid1', ['p1', 'p2']);
    gm.submitCaveTarget(game, 'cave1', 'cupid1'); // Cave ngu trung Cupid

    const result = engine.resolveNight(game);
    assert.strictEqual(game.couple, null, 'Khong duoc ghep cap khi Cave ngu trung Cupid dem do');
    assert.ok(result.log.some((l) => l.userId === 'cupid1' && l.text.includes('không ghép được cặp')));
    console.log('✅ Cupid OK: Cave ngủ trúng Cupid đêm đầu tiên → không ghép được cặp nào');
  }

  // ---------------------------------------------------------------------
  // Case 3: Cupid khong con la night actor tu dem 2 tro di
  // ---------------------------------------------------------------------
  {
    const game = {
      players: new Map(), dayNumber: 2, night: null, couple: null, cursedUserIds: new Set(), wolfCubBonusPending: false,
    };
    game.players.set('cupid1', makePlayer('cupid1', 'CUPID', 'villager'));
    game.players.set('p1', makePlayer('p1', 'DAN_THUONG', 'villager'));
    const actors = gm.getNightActors(game);
    assert.strictEqual(actors.length, 0, 'Cupid khong duoc tinh la night actor tu dem 2');
    console.log('✅ Cupid OK: không còn là night actor kể từ đêm 2 trở đi');
  }

  // ---------------------------------------------------------------------
  // Case 4: LOVERS thang khi cap khac phe la 2 nguoi song sot cuoi cung
  // ---------------------------------------------------------------------
  {
    const game = { players: new Map(), couple: ['villager1', 'wolf1'] };
    game.players.set('villager1', makePlayer('villager1', 'DAN_THUONG', 'villager'));
    game.players.set('wolf1', makePlayer('wolf1', 'SOI_THUONG', 'wolf'));
    const winner = engine.checkWinner(game);
    assert.strictEqual(winner, 'LOVERS', 'Cap khac phe la 2 nguoi song sot cuoi cung phai thang rieng');
    console.log('✅ Cupid OK: cặp khác phe thắng riêng (LOVERS) khi là 2 người sống sót cuối cùng');
  }

  console.log('\n=== TẤT CẢ TEST CUPID ĐỀU PASS ===');
}

run();
