const assert = require('node:assert');
const { getDefaultRoleSet, ROLES } = require('../src/game/constants');

function run() {
  for (let playerCount = 3; playerCount <= 20; playerCount++) {
    const roles = getDefaultRoleSet(playerCount);

    assert.strictEqual(roles.length, playerCount, `playerCount=${playerCount}: tong so role (${roles.length}) phai khop DUNG so nguoi choi`);

    const danCount = roles.filter((r) => r === 'DAN_THUONG').length;
    const soiThuongCount = roles.filter((r) => r === 'SOI_THUONG').length;
    const wolfCount = roles.filter((r) => ROLES[r].faction === 'wolf').length;
    const villagerCount = roles.filter((r) => ROLES[r].faction === 'villager').length;

    assert.ok(danCount >= 1, `playerCount=${playerCount}: phai co it nhat 1 Dan Thuong (co ${danCount})`);
    assert.ok(soiThuongCount >= 1, `playerCount=${playerCount}: phai co it nhat 1 Soi Thuong (co ${soiThuongCount})`);
    assert.ok(wolfCount >= 1 && villagerCount >= 1, `playerCount=${playerCount}: phai co it nhat 1 phe Soi va 1 phe Dan`);
    assert.ok(wolfCount < playerCount, `playerCount=${playerCount}: Soi khong duoc chiem het toan bo nguoi choi`);
  }
  console.log('✅ OK: getDefaultRoleSet luôn trả đúng số role = số người chơi, luôn có ≥1 Dân Thường và ≥1 Sói Thường, cho mọi playerCount từ 3-20');

  console.log('\n=== TẤT CẢ TEST CÂN BẰNG ROLE MẶC ĐỊNH ĐỀU PASS ===');
}

run();
