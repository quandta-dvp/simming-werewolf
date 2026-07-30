const { GameManager } = require('../src/game/GameManager');
const flow = require('../src/game/flow');

// ---- Mock discord client: khong goi API that, chi log lai ----
function createMockClient() {
  const dmLog = []; // {userId, payload}
  const channelLog = []; // {channelId, payload}
  const client = {
    users: {
      fetch: async (userId) => ({
        id: userId,
        username: `user_${userId}`,
        send: async (payload) => { dmLog.push({ userId, payload }); return { id: 'msg_' + Math.random() }; },
      }),
    },
    channels: {
      fetch: async (channelId) => ({
        id: channelId,
        send: async (payload) => { channelLog.push({ channelId, payload }); return { id: 'msg_' + Math.random() }; },
      }),
    },
  };
  return { client, dmLog, channelLog };
}

function findDm(dmLog, userId) {
  return dmLog.filter((d) => d.userId === userId);
}

async function run() {
  const gm = new GameManager();
  const { client, dmLog, channelLog } = createMockClient();

  const guildId = 'guild1';
  const channelId = 'chan1';
  const hostId = 'host';

  gm.createGame(guildId, channelId, hostId);
  const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', hostId];
  for (const id of playerIds) {
    if (id !== hostId) gm.join(guildId, id);
  }
  gm.setSelectedRoles(guildId, hostId, ['TIEN_TRI', 'BAO_VE', 'PHU_THUY', 'SOI_THUONG', 'SOI_THUONG']);

  const game = gm.startGame(guildId, hostId);
  await flow.beginNight(client, gm, game);

  const findRole = (roleId) => [...game.players.values()].find((p) => p.roleId === roleId);
  const wolves = [...game.players.values()].filter((p) => p.faction === 'wolf');
  const seer = findRole('TIEN_TRI');
  const guard = findRole('BAO_VE');
  const witch = findRole('PHU_THUY');
  const villagerTarget = [...game.players.values()].find((p) => p.roleId === 'DAN_THUONG');

  console.log('--- Vai trò đã random ---');
  for (const p of game.players.values()) console.log(p.userId, '->', p.roleId);

  console.log('\n--- DM đã gửi lúc bắt đầu đêm ---');
  console.log('Số DM gửi ra:', dmLog.length, '(kỳ vọng: mọi actor trừ Phù Thủy)');

  // Wolves can 1 nguoi dan thuong
  for (const w of wolves) {
    gm.submitWolfVote(game, w.userId, villagerTarget.userId);
    await flow.checkAndPromptWitch(client, game);
  }
  console.log('\n--- Sau khi Sói vote xong, Phù Thủy có được DM không? ---');
  console.log('DM cho Phù Thủy:', findDm(dmLog, witch.userId).length > 0);

  // Bao ve bao ve chinh nguoi bi can (test protect)
  gm.submitGuardTarget(game, guard.userId, villagerTarget.userId);
  await flow.maybeFinalizeNight(client, gm, game);

  // Tien tri soi 1 con soi
  gm.submitSeerTarget(game, seer.userId, wolves[0].userId);
  await flow.maybeFinalizeNight(client, gm, game);

  // Phu thuy: bo qua (khong cuu, khong doc) vi da duoc bao ve roi
  gm.submitWitchAction(game, witch.userId, { type: 'skip' });
  const completedBeforeFinalize = gm.isNightComplete(game);
  console.log('\nĐêm đã đủ hành động chưa (trước finalize)?', completedBeforeFinalize);

  await flow.maybeFinalizeNight(client, gm, game);

  console.log('\n--- Sau khi resolve đêm 1 ---');
  console.log('Người dân thường có sống không (được bảo vệ)?', villagerTarget.isAlive === true);
  console.log('Phase hiện tại:', game.phase, '| Ngày:', game.dayNumber);
  console.log('Thông báo ngày trong kênh:', channelLog[channelLog.length - 2]?.payload || channelLog[channelLog.length - 1]?.payload);

  // Kiem tra ket qua soi da gui cho Tien Tri
  const seerDms = findDm(dmLog, seer.userId);
  console.log('Kết quả soi gửi cho Tiên Tri:', seerDms[seerDms.length - 1]?.payload?.content);

  // ---- Ngay: vote treo Sói ----
  console.log('\n--- Bắt đầu vote ngày, mọi người vote treo Sói đầu tiên ---');
  const alive = gm.getAlivePlayers(game);
  for (const p of alive) {
    gm.submitDayVote(game, p.userId, wolves[0].userId);
  }
  await flow.maybeFinalizeDayVote(client, gm, game);

  console.log('Sói bị treo có isAlive=false không?', wolves[0].isAlive === false);
  console.log('Phase sau vote:', game.phase, '| Ngày:', game.dayNumber, '| Game status:', game.status);

  // ---- Dem 2: khong ai can (soi con lai tu vote nhung khong co soi khac de wolfVotes) ----
  // Con lai 1 con soi (wolves[1]) - no van phai vote (tu can chinh minh khong hop le vi loai tru wolf faction target)
  // De test win condition, ta se force ket thuc dem qua host endnight (khong ai submit) roi vote treo not soi con lai
  await flow.resolveAndAnnounceNight(client, gm, game); // host force end night 2, khong ai chet

  const stillAliveWolf = wolves[1];
  const aliveDay2 = gm.getAlivePlayers(game);
  for (const p of aliveDay2) {
    gm.submitDayVote(game, p.userId, stillAliveWolf.userId);
  }
  await flow.maybeFinalizeDayVote(client, gm, game);

  console.log('\n--- Sau khi treo nốt Sói còn lại ---');
  console.log('Game status:', game.status, '(kỳ vọng ENDED)');
  console.log('Game còn active trong GameManager không?', gm.getGame(guildId) !== null, '(kỳ vọng false)');
  const lastChannelMsg = channelLog[channelLog.length - 2]?.payload;
  console.log('Embed kết thúc game:', lastChannelMsg?.embeds?.[0]?.data?.title);

  console.log('\n=== TEST HOÀN TẤT, KHÔNG CÓ EXCEPTION ===');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
