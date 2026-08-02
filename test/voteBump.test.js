const assert = require('node:assert');
const { GameManager } = require('../src/game/GameManager');
const flow = require('../src/game/flow');

// Mock client toi gian, chi du de test bumpVoteMessage: gui/xoa tin nhan trong 1 kenh.
function createMockClient() {
  const messagesById = new Map();
  const deletedIds = new Set();
  const channelLog = [];

  function makeMessage(channelId, payload) {
    const id = 'msg_' + Math.random().toString(36).slice(2);
    const msg = {
      id,
      channelId,
      embeds: payload.embeds || [],
      components: payload.components || [],
      delete: async () => { deletedIds.add(id); messagesById.delete(id); },
    };
    messagesById.set(id, msg);
    return msg;
  }

  function makeChannel(channelId) {
    return {
      id: channelId,
      send: async (payload) => {
        const msg = makeMessage(channelId, payload);
        channelLog.push({ channelId, messageId: msg.id });
        return msg;
      },
      messages: {
        fetch: async (msgId) => {
          const msg = messagesById.get(msgId);
          if (!msg) throw new Error('message not found (da bi xoa)');
          return msg;
        },
      },
    };
  }

  const client = {
    channels: { fetch: async (id) => makeChannel(id) },
  };
  return {
    client, messagesById, deletedIds, channelLog,
  };
}

async function run() {
  const gm = new GameManager();
  const { client, messagesById, deletedIds } = createMockClient();

  const guildId = 'guild1';
  const channelId = 'chan1';
  const hostId = 'host';

  gm.createGame(guildId, channelId, hostId);
  for (const id of ['p1', 'p2', 'p3']) gm.join(guildId, id);
  gm.setSelectedRoles(guildId, hostId, ['SOI_THUONG']);
  const game = gm.startGame(guildId, hostId);
  game.phase = 'DAY_VOTE'; // gia lap dang trong luc vote, khong can di het dem that

  await flow.openDayVote(client, gm, game);
  const firstMessageId = game.voteMessageId;
  assert.ok(firstMessageId, 'openDayVote phai luu lai voteMessageId');
  assert.ok(game.voteBumpTimer, 'openDayVote phai khoi dong timer auto-bump');
  flow.stopVoteBump(game); // dung timer that lai, tu goi bumpVoteMessage thu cong de test khong can cho 5s

  // ---------------------------------------------------------------------
  // Case 1: bumpVoteMessage xoa tin cu, gui tin moi, giu nguyen ket qua vote hien tai
  // ---------------------------------------------------------------------
  gm.submitDayVote(game, 'p1', 'p2');
  await flow.bumpVoteMessage(client, gm, game);
  assert.ok(deletedIds.has(firstMessageId), 'Tin nhan vote cu phai bi xoa khi bump');
  assert.notStrictEqual(game.voteMessageId, firstMessageId, 'Phai co tin nhan vote moi sau khi bump');
  const secondMessageId = game.voteMessageId;
  const newMsg = messagesById.get(secondMessageId);
  assert.ok(newMsg, 'Tin nhan vote moi phai ton tai');
  const tallyText = newMsg.embeds[0].data.fields[0].value;
  assert.match(tallyText, /1 phiếu/, 'Bang tally moi phai giu nguyen ket qua vote da co (khong bi reset)');
  console.log('✅ voteBump OK: xóa tin cũ, gửi tin mới, giữ nguyên kết quả vote hiện tại');

  // ---------------------------------------------------------------------
  // Case 2: khong con dang DAY_VOTE (vd da resolve) -> bump khong lam gi them
  // ---------------------------------------------------------------------
  game.phase = 'DAY_DISCUSS';
  const beforeCount = messagesById.size;
  await flow.bumpVoteMessage(client, gm, game);
  assert.strictEqual(messagesById.size, beforeCount, 'Khong duoc gui them tin nhan khi da het phase DAY_VOTE');
  console.log('✅ voteBump OK: không gửi thêm tin khi phase không còn là DAY_VOTE');

  // ---------------------------------------------------------------------
  // Case 3: game da bi cancel/thay the (khong con la game active trong GameManager) -> cung dung
  // ---------------------------------------------------------------------
  game.phase = 'DAY_VOTE'; // dat lai de mo phong con dang vote luc bi cancel
  gm.cancelGame(guildId);
  const beforeCount2 = messagesById.size;
  await flow.bumpVoteMessage(client, gm, game);
  assert.strictEqual(messagesById.size, beforeCount2, 'Khong duoc bump tiep khi game da bi cancel/thay the trong GameManager');
  console.log('✅ voteBump OK: tự dừng khi game không còn active trong GameManager (vd đã bị cancel)');

  console.log('\n=== TẤT CẢ TEST VOTE BUMP ĐỀU PASS ===');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
