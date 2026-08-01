const assert = require('node:assert');
const flow = require('../src/game/flow');

function makePlayer(userId, roleId, faction, isAlive = true, state = {}) {
  return { userId, roleId, faction, isAlive, state };
}

function run() {
  // ---------------------------------------------------------------------
  // Kich ban: 7 nguoi choi, moi vai tro co chuc nang deu THUC HIEN hanh dong
  // (ke ca khi khong dan den ket qua gi, vd Sói vote 1 nguoi duoc Bao Ve cuu).
  // logNightActions() phai ghi lai LUA CHON cua tung nguoi, khong chi ket qua.
  // ---------------------------------------------------------------------
  const game = {
    dayNumber: 1,
    gameLog: [],
    displayNames: new Map([
      ['wolf1', 'Sói Một'], ['villager1', 'Dân Một'], ['guard1', 'Bảo Vệ Một'],
      ['seer1', 'Tiên Tri Một'], ['witch1', 'Phù Thủy Một'], ['cave1', 'Cave Một'],
      ['hunter1', 'Thợ Săn Một'],
    ]),
    players: new Map([
      ['wolf1', makePlayer('wolf1', 'SOI_THUONG', 'wolf')],
      ['villager1', makePlayer('villager1', 'DAN_THUONG', 'villager')],
      ['guard1', makePlayer('guard1', 'BAO_VE', 'villager')],
      ['seer1', makePlayer('seer1', 'TIEN_TRI', 'villager')],
      ['witch1', makePlayer('witch1', 'PHU_THUY', 'villager')],
      ['cave1', makePlayer('cave1', 'CAVE', 'villager')],
      ['hunter1', makePlayer('hunter1', 'THO_SAN', 'villager', true, { hunterTarget: 'villager1' })],
    ]),
    night: {
      wolfVotes: new Map([['wolf1', 'villager1']]), // Soi chon can villager1 (se bi Bao Ve cuu -> khong chet)
      curseTarget: null,
      guardTarget: 'villager1', // Bao Ve chon bao ve dung nguoi Soi can -> khong ai chet dem nay
      caveTarget: 'seer1', // Cave chon ngu cung Tien Tri (vo hieu hoa Tien Tri dem nay)
      witchAction: { type: 'skip' }, // Phu Thuy chon khong lam gi
      seerTarget: 'wolf1', // Tien Tri chon soi wolf1 (nhung se bi vo hieu hoa do Cave)
      submittedUserIds: new Set(['wolf1', 'villager1', 'guard1', 'seer1', 'witch1', 'cave1', 'hunter1']),
      promptMessages: [],
    },
    wolfCubBonusPending: false,
  };

  flow.logNightActions(game);

  const logByUser = new Map();
  for (const entry of game.gameLog) {
    if (!logByUser.has(entry.userId)) logByUser.set(entry.userId, []);
    logByUser.get(entry.userId).push(entry.text);
  }

  // Soi: phai ghi lai LUA CHON can ai, du sau nay khong chet vi duoc cuu
  assert.ok(logByUser.has('wolf1'), 'phai co log cho wolf1');
  assert.match(logByUser.get('wolf1')[0], /chọn cắn Dân Một/);
  console.log('✅ Log lựa chọn của Sói OK: "chọn cắn Dân Một" (dù không chết vì được bảo vệ)');

  // Bao Ve: phai ghi lai lua chon bao ve ai
  assert.ok(logByUser.has('guard1'));
  assert.match(logByUser.get('guard1')[0], /chọn bảo vệ Dân Một/);
  console.log('✅ Log lựa chọn của Bảo Vệ OK: "chọn bảo vệ Dân Một"');

  // Cave: phai ghi lai lua chon ngu cung ai
  assert.ok(logByUser.has('cave1'));
  assert.match(logByUser.get('cave1')[0], /chọn ngủ cùng Tiên Tri Một/);
  console.log('✅ Log lựa chọn của Cave OK: "chọn ngủ cùng Tiên Tri Một"');

  // Tien Tri: phai ghi lai lua chon soi ai (du bi Cave vo hieu hoa, day la LUA CHON khong phai KET QUA)
  assert.ok(logByUser.has('seer1'));
  assert.match(logByUser.get('seer1')[0], /chọn soi Sói Một/);
  console.log('✅ Log lựa chọn của Tiên Tri OK: "chọn soi Sói Một" (ghi lựa chọn dù bị vô hiệu hóa)');

  // Phu Thuy: phai ghi lai "khong dung binh nao" khi choose skip
  assert.ok(logByUser.has('witch1'));
  assert.match(logByUser.get('witch1')[0], /không dùng bình nào/);
  console.log('✅ Log lựa chọn của Phù Thủy OK: "không dùng bình nào" khi chọn skip');

  // Tho San: phai ghi lai muc tieu da chon truoc (vi da submit dem nay)
  assert.ok(logByUser.has('hunter1'));
  assert.match(logByUser.get('hunter1')[0], /chọn trước mục tiêu Dân Một/);
  console.log('✅ Log lựa chọn của Thợ Săn OK: "chọn trước mục tiêu Dân Một"');

  // Dan Thuong (khong co hanh dong dem) - khong duoc co log lua chon nao (vi khong co action)
  assert.ok(!logByUser.has('villager1'), 'Dân Thường không có action đêm nên không được có log lựa chọn');
  console.log('✅ Dân Thường (không có night action) OK: không tạo log thừa');

  // ---------------------------------------------------------------------
  // Test: Tho San CHUA submit dem nay (hunterTarget con luu tu truoc,
  // nhung khong nam trong submittedUserIds) -> KHONG duoc log lai lua chon cu
  // ---------------------------------------------------------------------
  {
    const game2 = {
      dayNumber: 2,
      gameLog: [],
      displayNames: new Map([['hunter1', 'Thợ Săn Một'], ['villager1', 'Dân Một']]),
      players: new Map([
        ['hunter1', makePlayer('hunter1', 'THO_SAN', 'villager', true, { hunterTarget: 'villager1' })], // tu dem truoc, chua doi
        ['villager1', makePlayer('villager1', 'DAN_THUONG', 'villager')],
      ]),
      night: {
        wolfVotes: new Map(),
        curseTarget: null, guardTarget: undefined, caveTarget: undefined,
        witchAction: undefined, seerTarget: undefined,
        submittedUserIds: new Set(), // hunter1 CHUA submit dem nay
        promptMessages: [],
      },
      wolfCubBonusPending: false,
    };
    flow.logNightActions(game2);
    const hunterLogs = game2.gameLog.filter((e) => e.userId === 'hunter1');
    assert.strictEqual(hunterLogs.length, 0, 'không được log lại lựa chọn cũ nếu Thợ Săn chưa submit đêm nay');
    console.log('✅ Thợ Săn OK: không log lại lựa chọn cũ khi chưa submit đêm nay (tránh hiểu nhầm)');
  }

  console.log('\n=== TẤT CẢ TEST LOG NIGHT ACTIONS ĐỀU PASS ===');
}

run();