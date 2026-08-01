const assert = require('node:assert');
const { renderGameSummaryImage } = require('../src/render/summaryImage');

function run() {
  // ---------------------------------------------------------------------
  // Test 1: renderGameSummaryImage khong duoc throw voi du lieu game that,
  // nhieu ngay, nhieu role, co nguoi song/chet, text log dai (test wrapText).
  // ---------------------------------------------------------------------
  {
    const game = {
      dayNumber: 3,
      players: new Map([
        ['w1', { userId: 'w1', roleId: 'SOI_THUONG', faction: 'wolf', isAlive: false }],
        ['w2', { userId: 'w2', roleId: 'SOI_NGUYEN', faction: 'wolf', isAlive: true }],
        ['v1', { userId: 'v1', roleId: 'DAN_THUONG', faction: 'villager', isAlive: false }],
        ['v2', { userId: 'v2', roleId: 'TIEN_TRI', faction: 'villager', isAlive: true }],
        ['v3', { userId: 'v3', roleId: 'PHU_THUY', faction: 'villager', isAlive: true }],
        ['t1', { userId: 't1', roleId: 'THANG_NGO', faction: 'third_party', isAlive: true }],
      ]),
      gameLog: [
        { dayNumber: 1, userId: 'v1', roleId: 'DAN_THUONG', text: 'bị Sói cắn chết' },
        { dayNumber: 1, userId: 'v2', roleId: 'TIEN_TRI', text: 'soi w1 ra là phe Sói, kết quả này khá dài để test việc xuống dòng trong ô của bảng tổng kết' },
        { dayNumber: 2, userId: 'w1', roleId: 'SOI_THUONG', text: 'bị dân làng treo cổ' },
        { dayNumber: 3, userId: 'v3', roleId: 'PHU_THUY', text: 'dùng độc giết 1 người khác' },
      ],
    };
    const displayNames = new Map([
      ['w1', 'Wolf Một'], ['w2', 'Wolf Hai'], ['v1', 'Dân Một'],
      ['v2', 'Tiên Tri'], ['v3', 'Phù Thủy'], ['t1', 'Thằng Ngố'],
    ]);

    const buffer = renderGameSummaryImage(game, displayNames, 'PHE DÂN LÀNG');
    assert.ok(Buffer.isBuffer(buffer), 'phai tra ve Buffer');
    assert.ok(buffer.length > 1000, 'PNG buffer phai co kich thuoc hop ly (khong rong)');
    // kiem tra magic bytes cua PNG
    assert.strictEqual(buffer[0], 0x89);
    assert.strictEqual(buffer[1], 0x50); // 'P'
    assert.strictEqual(buffer[2], 0x4e); // 'N'
    assert.strictEqual(buffer[3], 0x47); // 'G'
    console.log('✅ renderGameSummaryImage OK: tạo PNG hợp lệ với 6 người chơi, 3 ngày, text dài (' + buffer.length + ' bytes)');
  }

  // ---------------------------------------------------------------------
  // Test 2: render voi game rong / chi 1 nguoi / khong co log (edge case)
  // ---------------------------------------------------------------------
  {
    const game = {
      dayNumber: 1,
      players: new Map([['solo', { userId: 'solo', roleId: 'DAN_THUONG', faction: 'villager', isAlive: true }]]),
      gameLog: [],
    };
    const buffer = renderGameSummaryImage(game, new Map([['solo', 'Solo']]), 'PHE DÂN LÀNG');
    assert.ok(Buffer.isBuffer(buffer) && buffer.length > 0);
    console.log('✅ renderGameSummaryImage OK: không lỗi với game 1 người chơi, không có log');
  }

  // ---------------------------------------------------------------------
  // Test 3: gameLog thieu displayNames (userId la fallback) khong duoc throw
  // ---------------------------------------------------------------------
  {
    const game = {
      dayNumber: 1,
      players: new Map([['u1', { userId: 'u1', roleId: 'DAN_THUONG', faction: 'villager', isAlive: true }]]),
      gameLog: [],
    };
    const buffer = renderGameSummaryImage(game, new Map(), 'PHE DÂN LÀNG'); // displayNames rong
    assert.ok(Buffer.isBuffer(buffer) && buffer.length > 0);
    console.log('✅ renderGameSummaryImage OK: fallback dùng userId khi thiếu displayNames');
  }

  console.log('\n=== TẤT CẢ TEST SUMMARY IMAGE ĐỀU PASS ===');
}

run();
