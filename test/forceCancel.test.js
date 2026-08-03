const assert = require('node:assert');
const { GameManager } = require('../src/game/GameManager');
const flow = require('../src/game/flow');

// Mock client toi gian (giong integration.test.js) - du de forceCancelGame chay het
// (gui embed, gui file Excel, dong thread) ma khong can Discord that.
function createMockClient() {
  const sentToChannel = [];
  function makeChannel(channelId) {
    return {
      id: channelId,
      send: async (payload) => { sentToChannel.push({ channelId, payload }); return { id: 'm_' + Math.random(), channelId }; },
      threads: { create: async () => ({ id: 't', members: { add: async () => {} }, send: async () => ({}) }) },
      messages: { fetch: async () => { throw new Error('not found'); } },
    };
  }
  return {
    client: {
      users: { fetch: async (userId) => ({ id: userId, username: `user_${userId}`, send: async () => ({}) }) },
      channels: { fetch: async (id) => makeChannel(id) },
    },
    sentToChannel,
  };
}

async function run() {
  const gm = new GameManager();
  const { client, sentToChannel } = createMockClient();
  const guildId = 'g_cancel';

  gm.createGame(guildId, 'chan1', 'host1');
  for (const id of ['p1', 'p2', 'p3']) gm.join(guildId, id);
  gm.setSelectedRoles(guildId, 'host1', ['TIEN_TRI', 'SOI_THUONG']);
  const game = gm.startGame(guildId, 'host1');

  // Gia lap dang o mot phase bat ky giua tran (vd dang mo vote) - forceCancelGame phai xu ly duoc,
  // khong doi hoi phai o 1 phase cu the nao.
  game.phase = 'DAY_VOTE';
  game.dayVotes = new Map();
  game.voteBumpTimer = setInterval(() => {}, 999999); // gia lap timer auto-bump dang chay

  await flow.forceCancelGame(client, gm, game, 'host1');

  assert.strictEqual(game.status, 'ENDED', 'Game phai chuyen sang trang thai ENDED sau khi huy giua tran');
  assert.strictEqual(game.voteBumpTimer, null, 'Timer auto-bump vote phai duoc dung khi force-cancel');
  assert.strictEqual(gm.getGame(guildId), null, 'Game phai bi xoa khoi GameManager sau khi force-cancel (giong cancelGame binh thuong)');

  const cancelEmbedMsg = sentToChannel.find((m) => m.payload.embeds && m.payload.embeds[0]?.data?.title?.includes('HỦY GIỮA TRẬN'));
  assert.ok(cancelEmbedMsg, 'Phai gui thong bao cong khai roi vao khi bi huy giua tran');

  const excelMsg = sentToChannel.find((m) => m.payload.files);
  assert.ok(excelMsg, 'Van phai xuat file Excel tong ket ngay ca khi game bi huy giua chung');

  console.log('✅ OK: forceCancelGame hoạt động ở bất kỳ phase nào, dừng timer, dọn game khỏi GameManager, công bố role + xuất Excel');
  console.log('\n=== TẤT CẢ TEST FORCE CANCEL ĐỀU PASS ===');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
