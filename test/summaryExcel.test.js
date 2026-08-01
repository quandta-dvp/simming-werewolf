const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { renderGameSummaryExcel } = require('../src/render/summaryExcel');

async function run() {
  // ---------------------------------------------------------------------
  // Test 1: render voi du lieu game that, nhieu ngay, nhieu role, khong throw,
  // va noi dung doc lai dung (dung chinh exceljs de doc lai, khong chi kiem tra buffer).
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
        { dayNumber: 1, userId: 'v2', roleId: 'TIEN_TRI', text: 'soi w1 ra là phe Sói' },
        { dayNumber: 2, userId: 'w1', roleId: 'SOI_THUONG', text: 'bị dân làng treo cổ' },
        { dayNumber: 3, userId: 'v3', roleId: 'PHU_THUY', text: 'dùng độc giết 1 người khác' },
      ],
    };
    const displayNames = new Map([
      ['w1', 'Wolf Một'], ['w2', 'Wolf Hai'], ['v1', 'Dân Một'],
      ['v2', 'Tiên Tri'], ['v3', 'Phù Thủy'], ['t1', 'Thằng Ngố'],
    ]);

    const buffer = await renderGameSummaryExcel(game, displayNames, 'PHE DÂN LÀNG');
    assert.ok(Buffer.isBuffer(buffer), 'phai tra ve Buffer');
    assert.ok(buffer.length > 500, 'file xlsx phai co kich thuoc hop ly');
    // xlsx la file zip, magic bytes 'PK'
    assert.strictEqual(buffer[0], 0x50); // 'P'
    assert.strictEqual(buffer[1], 0x4b); // 'K'

    // doc lai bang chinh exceljs de kiem tra noi dung dung
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Kết quả trận');
    assert.ok(sheet, 'phai co sheet ten "Kết quả trận"');

    assert.strictEqual(sheet.getCell(1, 1).value, 'KẾT QUẢ TRẬN — PHE DÂN LÀNG THẮNG!');
    assert.strictEqual(sheet.getCell(2, 1).value, 'Người chơi');
    assert.strictEqual(sheet.getCell(2, 2).value, 'Vai trò');
    assert.strictEqual(sheet.getCell(2, 3).value, 'Ngày/Đêm 1');
    assert.strictEqual(sheet.getCell(2, 5).value, 'Ngày/Đêm 3');

    // hang dau tien phai la w1 (Wolf Một, Sói Thường, chet)
    assert.match(sheet.getCell(3, 1).value, /Wolf Một/);
    assert.strictEqual(sheet.getCell(3, 2).value, 'Sói Thường');
    assert.strictEqual(sheet.getCell(3, 4).value, 'bị dân làng treo cổ'); // ngay 2

    console.log('✅ renderGameSummaryExcel OK: tạo file .xlsx hợp lệ, đọc lại đúng nội dung (' + buffer.length + ' bytes)');
  }

  // ---------------------------------------------------------------------
  // Test 2: render voi 1 nguoi choi, khong co log (edge case) - khong duoc throw
  // ---------------------------------------------------------------------
  {
    const game = {
      dayNumber: 1,
      players: new Map([['solo', { userId: 'solo', roleId: 'DAN_THUONG', faction: 'villager', isAlive: true }]]),
      gameLog: [],
    };
    const buffer = await renderGameSummaryExcel(game, new Map([['solo', 'Solo']]), 'PHE DÂN LÀNG');
    assert.ok(Buffer.isBuffer(buffer) && buffer.length > 0);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Kết quả trận');
    assert.strictEqual(sheet.getCell(3, 3).value, '—', 'o khong co log phai hien dau gach ngang');
    console.log('✅ renderGameSummaryExcel OK: không lỗi với 1 người chơi, không có log (hiện "—")');
  }

  // ---------------------------------------------------------------------
  // Test 3: nhieu su kien trong cung 1 o (vd Tho San chet keo theo) phai gop dung dong
  // ---------------------------------------------------------------------
  {
    const game = {
      dayNumber: 1,
      players: new Map([['u1', { userId: 'u1', roleId: 'DAN_THUONG', faction: 'villager', isAlive: false }]]),
      gameLog: [
        { dayNumber: 1, userId: 'u1', roleId: 'DAN_THUONG', text: 'bị Sói cắn chết' },
        { dayNumber: 1, userId: 'u1', roleId: 'DAN_THUONG', text: 'bị Thợ Săn bắn chết theo' },
      ],
    };
    const buffer = await renderGameSummaryExcel(game, new Map([['u1', 'U1']]), 'PHE MA SÓI');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Kết quả trận');
    const cellValue = sheet.getCell(3, 3).value;
    assert.match(cellValue, /bị Sói cắn chết/);
    assert.match(cellValue, /bị Thợ Săn bắn chết theo/);
    console.log('✅ renderGameSummaryExcel OK: gộp đúng nhiều sự kiện trong cùng 1 ô (xuống dòng)');
  }

  console.log('\n=== TẤT CẢ TEST SUMMARY EXCEL ĐỀU PASS ===');
}

run();