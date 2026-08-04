const assert = require('node:assert');
const { GameManager } = require('../src/game/GameManager');

function run() {
  // ---------------------------------------------------------------------
  // Case 1: Host chi dinh chinh xac so Dan + Soi (cong voi vai dac biet da chon)
  // phai khop dung tong so nguoi choi, khong tu dong fill them.
  // ---------------------------------------------------------------------
  {
    const gm = new GameManager();
    gm.createGame('g1', 'chan1', 'host1');
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) gm.join('g1', id);
    const game = gm.getGame('g1');

    gm.setSelectedRoles('g1', 'host1', ['TIEN_TRI']); // 1 vai dac biet
    gm.setDanSoiCounts('g1', 'host1', 2, 2); // 1 + 2 + 2 = 5, khop dung 5 nguoi

    const roleList = gm.resolveFinalRoleList(game);
    assert.strictEqual(roleList.length, 5);
    assert.strictEqual(roleList.filter((r) => r === 'DAN_THUONG').length, 2, 'Phai co dung 2 Dan Thuong');
    assert.strictEqual(roleList.filter((r) => r === 'SOI_THUONG').length, 2, 'Phai co dung 2 Soi Thuong');
    assert.ok(roleList.includes('TIEN_TRI'), 'Van phai giu vai dac biet da chon');
    console.log('✅ OK: chỉ định chính xác số Dân/Sói khớp đúng tổng số người chơi hoạt động đúng');
  }

  // ---------------------------------------------------------------------
  // Case 2: Neu tong khong khop so nguoi choi -> phai bao loi ro rang, khong duoc
  // tu dong fill hay cat bot.
  // ---------------------------------------------------------------------
  {
    const gm = new GameManager();
    gm.createGame('g2', 'chan1', 'host1');
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) gm.join('g2', id);
    const game = gm.getGame('g2');

    gm.setSelectedRoles('g2', 'host1', ['TIEN_TRI']);
    gm.setDanSoiCounts('g2', 'host1', 1, 1); // 1 + 1 + 1 = 3, KHONG khop 5 nguoi

    assert.throws(() => gm.resolveFinalRoleList(game), /phải khớp ĐÚNG số người chơi/, 'Phai bao loi neu tong khong khop so nguoi choi');
    console.log('✅ OK: báo lỗi rõ ràng khi tổng số Dân+Sói+vai đặc biệt không khớp số người chơi');
  }

  // ---------------------------------------------------------------------
  // Case 3: Hanh vi CU van giu nguyen khi host chi chon vai dac biet, KHONG dung
  // tinh nang so luong moi - phan con lai tu dong la Dan Thuong (backward-compat).
  // ---------------------------------------------------------------------
  {
    const gm = new GameManager();
    gm.createGame('g3', 'chan1', 'host1');
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) gm.join('g3', id);
    const game = gm.getGame('g3');

    gm.setSelectedRoles('g3', 'host1', ['TIEN_TRI', 'BAO_VE']);
    // KHONG goi setDanSoiCounts

    const roleList = gm.resolveFinalRoleList(game);
    assert.strictEqual(roleList.length, 5);
    assert.strictEqual(roleList.filter((r) => r === 'DAN_THUONG').length, 3, 'Phan con lai (5-2=3) tu dong la Dan Thuong nhu hanh vi cu');
    console.log('✅ OK: hành vi cũ (không dùng tính năng số lượng mới) vẫn giữ nguyên — tự động fill Dân Thường');
  }

  // ---------------------------------------------------------------------
  // Case 4: Validate input so am / khong phai so nguyen bi tu choi som.
  // ---------------------------------------------------------------------
  {
    const gm = new GameManager();
    gm.createGame('g4', 'chan1', 'host1');
    for (const id of ['p1', 'p2', 'p3']) gm.join('g4', id);

    assert.throws(() => gm.setDanSoiCounts('g4', 'host1', -1, 0), /số nguyên ≥ 0/);
    assert.throws(() => gm.setDanSoiCounts('g4', 'host1', 1.5, 0), /số nguyên ≥ 0/);
    console.log('✅ OK: từ chối số Dân/Sói âm hoặc không phải số nguyên');
  }

  console.log('\n=== TẤT CẢ TEST SỐ LƯỢNG DÂN/SÓI ĐỀU PASS ===');
}

run();
