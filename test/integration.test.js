const { GameManager } = require('../src/game/GameManager');
const flow = require('../src/game/flow');

function createMockClient() {
  const dmLog = [];
  const channelLog = [];
  let threadCounter = 0;
  const messagesById = new Map();
  const threadsById = new Map();
  const deletedThreadIds = new Set();

  function makeMessage(channelId, payload) {
    const id = 'msg_' + Math.random().toString(36).slice(2);
    const msg = {
      id,
      channelId,
      embeds: payload.embeds || [],
      components: payload.components || [],
      edit: async (newPayload) => {
        msg.embeds = newPayload.embeds || msg.embeds;
        msg.components = newPayload.components || msg.components;
        return msg;
      },
      delete: async () => { messagesById.delete(id); },
    };
    messagesById.set(id, msg);
    return msg;
  }

  function makeChannel(channelId) {
    return {
      id: channelId,
      send: async (payload) => {
        channelLog.push({ channelId, payload });
        return makeMessage(channelId, payload);
      },
      messages: {
        fetch: async (arg) => {
          if (typeof arg === 'object' && arg.limit) {
            return new Map([...messagesById.values()].filter((m) => m.channelId === channelId).map((m) => [m.id, m]));
          }
          const msg = messagesById.get(arg);
          if (!msg) throw new Error('message not found');
          return msg;
        },
      },
      threads: {
        create: async ({ name }) => {
          threadCounter += 1;
          const threadId = `thread_${threadCounter}`;
          const thread = {
            id: threadId,
            name,
            members: { add: async (userId) => { thread._members.push(userId); } },
            _members: [],
            send: async (payload) => { channelLog.push({ channelId: threadId, payload }); return makeMessage(threadId, payload); },
            messages: {
              fetch: async (msgId) => {
                const msg = messagesById.get(msgId);
                if (!msg) throw new Error('message not found');
                return msg;
              },
            },
            setArchived: async () => { thread.archived = true; },
            setLocked: async () => { thread.locked = true; },
            delete: async () => { deletedThreadIds.add(threadId); },
          };
          threadsById.set(threadId, thread);
          return thread;
        },
      },
    };
  }

  const client = {
    users: {
      fetch: async (userId) => ({
        id: userId,
        username: `user_${userId}`,
        send: async (payload) => { dmLog.push({ userId, payload }); return makeMessage('dm_' + userId, payload); },
      }),
    },
    channels: {
      fetch: async (id) => {
        if (threadsById.has(id)) return threadsById.get(id);
        return makeChannel(id);
      },
    },
  };
  return {
    client, dmLog, channelLog, threadsById, deletedThreadIds, messagesById,
  };
}

async function run() {
  const gm = new GameManager();
  const {
    client, dmLog, channelLog, threadsById, deletedThreadIds, messagesById,
  } = createMockClient();

  const guildId = 'guild1';
  const channelId = 'chan1';
  const hostId = 'host';

  gm.createGame(guildId, channelId, hostId);
  const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
  for (const id of playerIds) gm.join(guildId, id);
  gm.setSelectedRoles(guildId, hostId, ['TIEN_TRI', 'BAO_VE', 'PHU_THUY', 'SOI_THUONG', 'SOI_THUONG']);

  const game = gm.startGame(guildId, hostId);

  console.log('--- sendRoleRevealAnnouncement ---');
  await flow.sendRoleRevealAnnouncement(client, game);
  console.log('Channel messages sau reveal:', channelLog.length);

  console.log('\n--- setupRoleThreads ---');
  await flow.setupRoleThreads(client, game);
  console.log('Threads đã tạo:', Object.keys(game.threads));
  for (const [group, tid] of Object.entries(game.threads)) {
    const t = threadsById.get(tid);
    console.log(`  ${group} (${tid}) members:`, t._members);
  }

  console.log('\n--- postOrBumpControlPanel ---');
  await flow.postOrBumpControlPanel(client, game);
  console.log('panelMessageId set?', !!game.panelMessageId);

  console.log('\n--- beginNight ---');
  await flow.beginNight(client, gm, game);
  const night1PromptMessages = [...game.night.promptMessages]; // luu lai truoc khi bi ghi de o dem sau

  const findRole = (roleId) => [...game.players.values()].find((p) => p.roleId === roleId);
  const wolves = [...game.players.values()].filter((p) => p.faction === 'wolf');
  const seer = findRole('TIEN_TRI');
  const guard = findRole('BAO_VE');
  const witch = findRole('PHU_THUY');
  const villagerTarget = [...game.players.values()].find((p) => p.roleId === 'DAN_THUONG');

  console.log('\nVai trò random:');
  for (const p of game.players.values()) console.log(' ', p.userId, '->', p.roleId);

  for (const w of wolves) {
    gm.submitWolfVote(game, w.userId, villagerTarget.userId);
    await flow.checkAndPromptWitch(client, game);
  }
  console.log('\nPhù Thủy được gửi tin trong thread PHU_THUY?', channelLog.some((c) => c.channelId === game.threads.PHU_THUY));

  gm.submitGuardTarget(game, guard.userId, villagerTarget.userId);
  gm.submitSeerTarget(game, seer.userId, wolves[0].userId);
  gm.submitWitchAction(game, witch.userId, { type: 'skip' });
  await flow.maybeFinalizeNight(client, gm, game);

  console.log('\nSau đêm 1:');
  console.log('  Người dân được bảo vệ có sống không?', villagerTarget.isAlive === true);
  console.log('  Phase hiện tại:', game.phase, '(kỳ vọng DAY_DISCUSS)');
  console.log('  Số menu đêm 1 đã gửi:', night1PromptMessages.length);
  console.log('  TẤT CẢ menu đêm 1 đã bị vô hiệu hóa (components rỗng) sau khi resolve?',
    night1PromptMessages.every(({ messageId }) => {
      const msg = messagesById.get(messageId);
      return msg && msg.components.length === 0;
    }));

  console.log('\n--- Host mở vote ---');
  await flow.openDayVote(client, gm, game);
  const alive = gm.getAlivePlayers(game);
  for (const p of alive) gm.submitDayVote(game, p.userId, wolves[0].userId);
  await flow.maybeFinalizeDayVote(client, gm, game);

  console.log('Sói đầu tiên bị treo?', wolves[0].isAlive === false);
  console.log('Phase/ngày sau vote:', game.phase, game.dayNumber);

  console.log('\n--- Kết thúc: treo nốt sói còn lại để test endGame + đóng thread ---');
  await flow.resolveAndAnnounceNight(client, gm, game);
  await flow.openDayVote(client, gm, game);
  const alive2 = gm.getAlivePlayers(game);
  for (const p of alive2) gm.submitDayVote(game, p.userId, wolves[1].userId);
  await flow.maybeFinalizeDayVote(client, gm, game);

  console.log('Game status:', game.status, '(kỳ vọng ENDED)');
  console.log('Tất cả thread đã bị XÓA chưa?', Object.values(game.threads).every((tid) => deletedThreadIds.has(tid)));
  console.log('Game còn active trong GameManager?', gm.getGame(guildId) !== null, '(kỳ vọng false)');

  console.log('\n=== TEST HOÀN TẤT, KHÔNG CÓ EXCEPTION ===');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
