const assert = require('node:assert');
const { GameManager } = require('../src/game/GameManager');
const flow = require('../src/game/flow');

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
  const guildId = 'g_race';

  gm.createGame(guildId, 'chan1', 'host1');
  for (const id of ['p1', 'p2', 'p3']) gm.join(guildId, id);
  gm.setSelectedRoles(guildId, 'host1', ['SOI_THUONG']);
  const game = gm.startGame(guildId, 'host1');
  game.phase = 'DAY_VOTE';
  game.dayVotes = new Map();
  const alive = [...game.players.values()];
  for (const p of alive) gm.submitDayVote(game, p.userId, null); // moi nguoi chon "khong treo ai" cho don gian

  // Gia lap 2 su kien gan nhu dong thoi cung goi resolve (vd 2 nguoi vote xong gan nhu cung luc,
  // hoac 1 nguoi vote cuoi dung luc host bam "Ket Thuc Vote").
  await Promise.all([
    flow.resolveAndAnnounceDayVote(client, gm, game),
    flow.resolveAndAnnounceDayVote(client, gm, game),
  ]);

  const nightAnnouncements = sentToChannel.filter((m) => typeof m.payload === 'string' && m.payload.includes('mọi người đi ngủ'));
  const voteReasonMsgs = sentToChannel.filter((m) => typeof m.payload === 'string' && m.payload.includes('không ai bị treo cổ'));

  assert.strictEqual(voteReasonMsgs.length, 1, 'Chi duoc thong bao ket qua vote DUY NHAT 1 lan du bi goi resolve 2 lan gan nhu dong thoi');
  assert.strictEqual(game.dayNumber, 2, 'dayNumber chi duoc tang len DUNG 1 LAN (khong bi nhay 2 dem)');
  console.log('✅ OK: gọi resolveAndAnnounceDayVote 2 lần gần như đồng thời chỉ thực sự resolve 1 lần (không bị nhảy đêm/nhân đôi thông báo)');

  console.log('\n=== TEST RACE CONDITION PASS ===');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
