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
  // Case 1: Cave/Guard/Seer/Curse deu duoc phep chon lai (doi y) truoc khi dem ket thuc.
  // ---------------------------------------------------------------------
  {
    const game = {
      players: new Map(), dayNumber: 1, cursedUserIds: new Set(), wolfCubBonusPending: false,
    };
    game.players.set('cave1', makePlayer('cave1', 'CAVE', 'villager'));
    game.players.set('guard1', makePlayer('guard1', 'BAO_VE', 'villager'));
    game.players.set('seer1', makePlayer('seer1', 'TIEN_TRI', 'villager'));
    game.players.set('wolfCursed1', makePlayer('wolfCursed1', 'SOI_NGUYEN', 'wolf'));
    game.players.set('p1', makePlayer('p1', 'DAN_THUONG', 'villager'));
    game.players.set('p2', makePlayer('p2', 'DAN_THUONG', 'villager'));
    gm.beginNightState(game);

    gm.submitCaveTarget(game, 'cave1', 'p1');
    gm.submitCaveTarget(game, 'cave1', 'p2'); // doi y
    assert.strictEqual(game.night.caveTarget, 'p2', 'Cave duoc doi y, lay lua chon cuoi');

    gm.submitGuardTarget(game, 'guard1', 'p1');
    gm.submitGuardTarget(game, 'guard1', 'p2'); // doi y
    assert.strictEqual(game.night.guardTarget, 'p2', 'Bao Ve duoc doi y, lay lua chon cuoi');

    gm.submitSeerTarget(game, 'seer1', 'p1');
    gm.submitSeerTarget(game, 'seer1', 'p2'); // doi y
    assert.strictEqual(game.night.seerTarget, 'p2', 'Tien Tri duoc doi y, lay lua chon cuoi');

    gm.submitCurseTarget(game, 'wolfCursed1', 'p1');
    gm.submitCurseTarget(game, 'wolfCursed1', null); // doi y sang khong nguyen ai
    assert.strictEqual(game.night.curseTarget, null, 'Soi Nguyen duoc doi y, ke ca doi sang khong nguyen ai');

    console.log('✅ OK: Cave/Bảo Vệ/Tiên Tri/Sói Nguyền đều đổi ý được trong cùng 1 đêm, lấy lựa chọn cuối cùng');
  }

  // ---------------------------------------------------------------------
  // Case 2: Phu Thuy doi y (heal -> poison -> skip) trong CUNG 1 dem khong duoc
  // lam mat oan binh nao ca - chi binh THUC SU dung (theo lua chon CUOI) moi bi
  // khoa vinh vien, va chi chot luc resolveNight (khong chot ngay luc submit).
  // ---------------------------------------------------------------------
  {
    const game = {
      players: new Map(), dayNumber: 1, cursedUserIds: new Set(), wolfCubBonusPending: false,
    };
    game.players.set('witch1', makePlayer('witch1', 'PHU_THUY', 'villager'));
    game.players.set('wolf1', makePlayer('wolf1', 'SOI_THUONG', 'wolf'));
    game.players.set('p1', makePlayer('p1', 'DAN_THUONG', 'villager'));
    game.players.set('p2', makePlayer('p2', 'DAN_THUONG', 'villager'));
    game.night = {
      wolfVotes: new Map([['wolf1', 'p1']]),
      guardTarget: undefined, caveTarget: undefined, seerTarget: null, curseTarget: null, witchAction: undefined,
      submittedUserIds: new Set(),
    };

    // Doi y nhieu lan trong cung 1 dem: heal -> poison p2 -> lai heal (lua chon cuoi cung)
    gm.submitWitchAction(game, 'witch1', { type: 'heal', targetId: 'p1' });
    assert.strictEqual(game.players.get('witch1').state.healUsed, undefined, 'Chua duoc chot healUsed ngay luc submit (chi chot luc resolve)');

    gm.submitWitchAction(game, 'witch1', { type: 'poison', targetId: 'p2' });
    assert.strictEqual(game.players.get('witch1').state.poisonUsed, undefined, 'Chua duoc chot poisonUsed ngay luc submit (chi chot luc resolve)');

    gm.submitWitchAction(game, 'witch1', { type: 'heal', targetId: 'p1' }); // doi y lan cuoi: quay lai heal

    const result = engine.resolveNight(game);

    assert.strictEqual(game.players.get('witch1').state.healUsed, true, 'Lua chon CUOI CUNG (heal) moi bi khoa binh cuu');
    assert.strictEqual(game.players.get('witch1').state.poisonUsed, undefined, 'Khong duoc mat oan binh doc chi vi tung thu chon roi doi y');
    assert.strictEqual(game.players.get('p1').isAlive, true, 'p1 phai duoc cuu (heal la lua chon cuoi cung)');
    assert.strictEqual(game.players.get('p2').isAlive, true, 'p2 khong bi sao vi Phu Thuy da doi y, khong con dau doc p2 nua');
    console.log('✅ OK: Phù Thủy đổi ý nhiều lần trong cùng 1 đêm không bị mất oan bình, chỉ khóa bình theo lựa chọn CUỐI CÙNG lúc resolve');
  }

  console.log('\n=== TẤT CẢ TEST RE-SELECTION ĐỀU PASS ===');
}

run();
