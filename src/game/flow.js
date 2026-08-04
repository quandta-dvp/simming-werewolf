const {
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, AttachmentBuilder,
} = require('discord.js');
const { ROLES, FACTION } = require('./constants');
const { GameManager } = require('./GameManager');
const engine = require('./engine');
const { renderGameSummaryExcel } = require('../render/summaryExcel');
const { saveFinishedGame, saveCancelledGame } = require('../db/gameRepository');

async function cacheDisplayNames(client, game) {
  game.displayNames = game.displayNames || new Map();
  for (const userId of game.players.keys()) {
    if (!game.displayNames.has(userId)) {
      try {
        const user = await client.users.fetch(userId);
        game.displayNames.set(userId, user.username);
      } catch {
        game.displayNames.set(userId, userId);
      }
    }
  }
}

function nameOf(game, userId) {
  return (game.displayNames && game.displayNames.get(userId)) || userId;
}

function aliveOptions(game, { excludeUserId, excludeFaction } = {}) {
  return [...game.players.values()]
    .filter((p) => p.isAlive)
    .filter((p) => !excludeUserId || p.userId !== excludeUserId)
    .filter((p) => !excludeFaction || p.faction !== excludeFaction)
    .slice(0, 24) // chua 1 slot cho tuy chon "Khong treo ai" o vote ngay
    .map((p) => ({ label: nameOf(game, p.userId), value: p.userId }));
}

async function dmUser(client, userId, payload) {
  const user = await client.users.fetch(userId);
  return user.send(payload);
}

async function channelSend(client, channelId, payload) {
  const channel = await client.channels.fetch(channelId);
  return channel.send(payload);
}

// ============ THREADS THEO VAI TRO ============

async function setupRoleThreads(client, game) {
  const groups = new Map(); // groupKey -> [player,...]
  for (const p of game.players.values()) {
    const group = GameManager.threadGroupOf(p.roleId, p.faction);
    if (!group) continue;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(p);
  }

  const groupLabel = {
    TIEN_TRI: '🔮-tien-tri', BAO_VE: '🛡️-bao-ve', PHU_THUY: '🧪-phu-thuy', CAVE: '🕊️-cave', WOLVES: '🐺-bay-soi', CUPID: '💘-cupid',
  };

  const channel = await client.channels.fetch(game.channelId);
  for (const [groupKey, players] of groups.entries()) {
    try {
      const thread = await channel.threads.create({
        name: groupLabel[groupKey] || groupKey,
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: 'Simming Werewolf - thread vai trò',
      });
      game.threads[groupKey] = thread.id;
      await thread.members.add(game.hostId).catch(() => {});
      for (const p of players) {
        await thread.members.add(p.userId).catch(() => {});
      }
      await thread.send(`👋 Thread riêng cho vai trò này. Host (<@${game.hostId}>) được thêm vào để theo dõi, không thao tác.`);
    } catch (err) {
      console.error(`[setupRoleThreads] Không tạo được thread ${groupKey}, sẽ fallback DM:`, err.message);
    }
  }
}

async function addPlayerToRoleThread(client, game, groupKey, userId) {
  const threadId = game.threads[groupKey];
  if (!threadId) return;
  try {
    const thread = await client.channels.fetch(threadId);
    await thread.members.add(userId);
    await thread.send(`🔁 <@${userId}> vừa được thêm vào thread này.`);
  } catch (err) {
    console.error('[addPlayerToRoleThread] lỗi:', err.message);
  }
}

async function closeAllThreads(game, client) {
  for (const threadId of Object.values(game.threads)) {
    try {
      const thread = await client.channels.fetch(threadId);
      await thread.delete('Game kết thúc');
    } catch (err) {
      console.error('[closeAllThreads] lỗi:', err.message);
    }
  }
}

// Gui 1 payload vao thread cua group; fallback DM cho nguoi giu role neu khong co thread
async function sendToRoleChannel(client, game, groupKey, holderUserId, payload) {
  const threadId = game.threads[groupKey];
  let msg;
  if (threadId) {
    try {
      const thread = await client.channels.fetch(threadId);
      msg = await thread.send(payload);
    } catch (err) {
      console.error(`[sendToRoleChannel] lỗi gửi vào thread ${groupKey}, fallback DM:`, err.message);
    }
  }
  if (!msg) msg = await dmUser(client, holderUserId, payload);
  if (game.night && msg?.id) game.night.promptMessages.push({ channelId: msg.channelId || game.threads[groupKey], messageId: msg.id });
  return msg;
}

// Vo hieu hoa (xoa component) toan bo menu da gui trong dem, tranh nguoi choi bam nham menu cu
// sau khi da sang dem/ngay khac - day la nguyen nhan gay hien tuong "chon duoc 2 nguoi".
async function disableNightPrompts(client, game) {
  if (!game.night || !game.night.promptMessages) return;
  for (const { channelId, messageId } of game.night.promptMessages) {
    try {
      const channel = await client.channels.fetch(channelId);
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({ components: [] });
    } catch { /* tin nhan co the da bi xoa hoac da duoc disable, bo qua */ }
  }
}

// ============ CONTROL PANEL ============

function roleCountsText(game) {
  const counts = new Map();
  for (const p of game.players.values()) {
    counts.set(p.roleId, (counts.get(p.roleId) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([roleId, count]) => `${count} ${ROLES[roleId].name.toLowerCase()}`)
    .join(', ');
}

function phaseLabel(game) {
  if (game.phase === 'NIGHT') return `🌙 Đêm ${game.dayNumber}`;
  if (game.phase === 'DAY_DISCUSS') return `☀️ Ngày ${game.dayNumber} — đang thảo luận`;
  if (game.phase === 'DAY_VOTE') return `🗳️ Ngày ${game.dayNumber} — đang bỏ phiếu`;
  return game.phase || 'Chưa bắt đầu';
}

function buildControlPanelEmbed(game) {
  const alive = [...game.players.values()].filter((p) => p.isAlive);
  const dead = [...game.players.values()].filter((p) => !p.isAlive);
  const aliveText = alive.map((p, i) => `[${i + 1}] <@${p.userId}>`).join('\n') || '_(không còn ai)_';
  const deadText = dead.map((p, i) => `[${i + 1}] ~~<@${p.userId}>~~`).join('\n') || '_(chưa có ai chết)_';

  return new EmbedBuilder()
    .setTitle('🐺 Simming Werewolf — Bảng Điều Khiển')
    .setColor(0x8b0000)
    .addFields(
      { name: 'Kênh chơi', value: `<#${game.channelId}>`, inline: true },
      { name: 'Giai đoạn', value: phaseLabel(game), inline: true },
      { name: 'Host', value: `<@${game.hostId}>`, inline: true },
      { name: `${game.players.size} Roles`, value: roleCountsText(game) },
      { name: `👥 Còn sống — ${alive.length}/${game.players.size}`, value: aliveText, inline: true },
      { name: `💀 Đã chết — ${dead.length}/${game.players.size}`, value: deadText, inline: true },
      { name: '\u200b', value: `Bắt đầu: <t:${Math.floor(game.startedAt / 1000)}:R>` },
    )
    .setTimestamp();
}

function buildControlPanelButtons() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sw_panel_bump').setLabel('Cập Nhật').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sw_panel_skip').setLabel('Bỏ Qua Đêm/Ngày').setEmoji('⏭️').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sw_panel_open_vote').setLabel('Mở Vote').setEmoji('🗳️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('sw_panel_end_vote').setLabel('Kết Thúc Vote').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sw_panel_force_cancel').setLabel('Hủy Game Giữa Trận').setEmoji('🛑').setStyle(ButtonStyle.Danger),
  );
  return [row1, row2, row3];
}

async function postOrBumpControlPanel(client, game) {
  // Xoa panel cu (neu con) de "bump" len cuoi kenh
  if (game.panelChannelId && game.panelMessageId) {
    try {
      const oldChannel = await client.channels.fetch(game.panelChannelId);
      const oldMsg = await oldChannel.messages.fetch(game.panelMessageId);
      await oldMsg.delete();
    } catch { /* da bi xoa hoac khong tim thay, bo qua */ }
  }
  const msg = await channelSend(client, game.channelId, {
    embeds: [buildControlPanelEmbed(game)],
    components: buildControlPanelButtons(),
  });
  game.panelChannelId = game.channelId;
  game.panelMessageId = msg.id;
  return msg;
}

async function refreshControlPanelInPlace(client, game) {
  if (!game.panelChannelId || !game.panelMessageId) return;
  try {
    const channel = await client.channels.fetch(game.panelChannelId);
    const msg = await channel.messages.fetch(game.panelMessageId);
    await msg.edit({ embeds: [buildControlPanelEmbed(game)], components: buildControlPanelButtons() });
  } catch { /* panel co the da bi xoa, bo qua */ }
}

// ============ ROLE REVEAL SAU KHI START ============

async function sendRoleRevealAnnouncement(client, game) {
  await cacheDisplayNames(client, game);
  const embed = new EmbedBuilder()
    .setTitle('🐺 Simming Werewolf')
    .setDescription(`<@${game.hostId}> đã bắt đầu ván chơi.\n**${phaseLabel(game)}**\n\n_Bấm nút bên dưới để xem vai trò của bạn._`)
    .setColor(0x8b0000);
  const button = new ButtonBuilder().setCustomId('sw_show_role').setLabel('Xem Vai Trò Của Bạn').setEmoji('🎭').setStyle(ButtonStyle.Success);
  await channelSend(client, game.channelId, { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
}

function buildOwnRoleEmbed(game, player) {
  const role = ROLES[player.roleId];
  return new EmbedBuilder()
    .setTitle(`${role.emoji} Vai trò của bạn: ${role.name}`)
    .setColor(0x2b2d31)
    .setDescription(role.description);
}

function buildFullRoleListEmbed(game) {
  const lines = [...game.players.values()].map((p) => `${ROLES[p.roleId].emoji} <@${p.userId}> — **${ROLES[p.roleId].name}**`);
  return new EmbedBuilder().setTitle('🎭 Toàn bộ vai trò (chỉ Host thấy)').setDescription(lines.join('\n')).setColor(0x2b2d31);
}

// ============ NIGHT ============

async function beginNight(client, gameManager, game) {
  gameManager.beginNightState(game);
  await cacheDisplayNames(client, game);

  const actors = gameManager.getNightActors(game);
  for (const player of actors) {
    if (player.roleId === 'PHU_THUY') continue; // Phu Thuy nhan tin sau khi Soi vote xong
    try {
      await sendNightPrompt(client, game, player);
    } catch (err) {
      console.error(`[beginNight] Lỗi gửi prompt cho ${player.userId}:`, err.message);
    }
  }

  await channelSend(client, game.channelId, `🌙 **Đêm ${game.dayNumber}** bắt đầu — mọi người đi ngủ. Các vai trò có chức năng đang nhận thông báo trong thread riêng.`);
  await refreshControlPanelInPlace(client, game);
}

async function sendNightPrompt(client, game, player) {
  const roleId = player.roleId;
  const group = GameManager.threadGroupOf(roleId, player.faction);

  if (roleId === 'TIEN_TRI') {
    const options = aliveOptions(game, { excludeUserId: player.userId });
    if (!options.length) return;
    const menu = new StringSelectMenuBuilder().setCustomId('sw_seer_pick').setPlaceholder('Chọn người để soi').setMinValues(1).setMaxValues(1).addOptions(options);
    await sendToRoleChannel(client, game, group, player.userId, {
      content: `🔮 <@${player.userId}> — **Đêm ${game.dayNumber} — Tiên Tri**\nChọn 1 người để soi phe:`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
    return;
  }

  if (roleId === 'BAO_VE') {
    const options = aliveOptions(game).concat([{ label: 'Không bảo vệ ai đêm nay', value: 'SKIP' }]);
    const menu = new StringSelectMenuBuilder().setCustomId('sw_guard_pick').setPlaceholder('Chọn người để bảo vệ').setMinValues(1).setMaxValues(1).addOptions(options);
    await sendToRoleChannel(client, game, group, player.userId, {
      content: `🛡️ <@${player.userId}> — **Đêm ${game.dayNumber} — Bảo Vệ**\nChọn 1 người để bảo vệ (không trùng người đêm trước):`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
    return;
  }

  if (roleId === 'CAVE') {
    const options = aliveOptions(game, { excludeUserId: player.userId }).concat([{ label: 'Ngủ một mình', value: 'ALONE' }]);
    const menu = new StringSelectMenuBuilder().setCustomId('sw_cave_pick').setPlaceholder('Chọn người để ngủ cùng').setMinValues(1).setMaxValues(1).addOptions(options);
    await sendToRoleChannel(client, game, group, player.userId, {
      content: `🕊️ <@${player.userId}> — **Đêm ${game.dayNumber} — Cave**\nChọn người để ngủ cùng (không trùng người đêm trước):`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
    return;
  }

  if (roleId === 'THO_SAN') {
    const options = aliveOptions(game, { excludeUserId: player.userId });
    if (!options.length) return;
    const menu = new StringSelectMenuBuilder().setCustomId('sw_hunter_pick').setPlaceholder('Chọn người để nhắm trước').setMinValues(1).setMaxValues(1).addOptions(options);
    const current = player.state.hunterTarget ? `\n_Hiện đang nhắm: **${nameOf(game, player.state.hunterTarget)}**_` : '';
    await sendToRoleChannel(client, game, group, player.userId, {
      content: `🏹 <@${player.userId}> — **Đêm ${game.dayNumber} — Thợ Săn**\nChọn trước 1 người — nếu bạn chết (đêm hoặc bị treo), người này sẽ chết theo ngay lập tức:${current}`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
    return;
  }

  if (roleId === 'CUPID') {
    const options = aliveOptions(game); // Cupid duoc phep ghep ca chinh minh
    if (options.length < 2) return;
    const menu = new StringSelectMenuBuilder().setCustomId('sw_cupid_pick').setPlaceholder('Chọn đúng 2 người để ghép cặp').setMinValues(2).setMaxValues(2).addOptions(options);
    await sendToRoleChannel(client, game, group, player.userId, {
      content: `💘 <@${player.userId}> — **Đêm ${game.dayNumber} — Cupid**\nChọn đúng 2 người để ghép thành 1 cặp (chỉ dùng được đêm đầu tiên). Nếu sau này 1 người trong cặp chết, người kia chết theo; nếu 2 người khác phe sống sót đến khi chỉ còn lại 2 người, họ thắng riêng:`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
    return;
  }

  if (player.faction === FACTION.WOLF) {
    // Bat ky ai thuoc phe Soi deu tham gia vote can chung - ke ca Ban Soi da bi can trung va
    // chuyen phe (roleId van la BAN_SOI, chi faction doi thanh wolf).
    // Chi gui 1 lan cho ca bay (tranh spam nhieu tin nhac giong nhau) - kiem tra cờ da gui chua
    if (!game.night.wolfPromptSent) {
      game.night.wolfPromptSent = true;
      const options = aliveOptions(game, { excludeFaction: FACTION.WOLF });
      const menu = new StringSelectMenuBuilder().setCustomId('sw_wolf_vote').setPlaceholder('Chọn người để cắn').setMinValues(1).setMaxValues(1).addOptions(options);
      const extra = game.wolfCubBonusPending ? '\n🐾 *Sói Con đã hy sinh — đêm nay bầy được cắn 2 người!*' : '';
      await sendToRoleChannel(client, game, 'WOLVES', player.userId, {
        content: `🐺 **Đêm ${game.dayNumber} — Bầy Sói**\nCả bầy cùng chọn 1 người để cắn (ai vote sau sẽ thấy tỉ lệ hiện tại):${extra}`,
        components: [new ActionRowBuilder().addComponents(menu)],
      });
    }
    if (roleId === 'SOI_NGUYEN') {
      const curseOptions = aliveOptions(game, { excludeFaction: FACTION.WOLF });
      const curseMenu = new StringSelectMenuBuilder().setCustomId('sw_curse_pick').setPlaceholder('(Tùy chọn) Nguyền ai đó').setMinValues(0).setMaxValues(1).addOptions(curseOptions);
      await sendToRoleChannel(client, game, 'WOLVES', player.userId, {
        content: `☠️ <@${player.userId}> — **Sói Nguyền** (tùy chọn) chọn 1 người để nguyền:`,
        components: [new ActionRowBuilder().addComponents(curseMenu)],
      });
    }
  }
}

function buildWolfVoteTallyContent(game) {
  const lines = [...game.night.wolfVotes.entries()].map(([voterId, targetId]) => `**${nameOf(game, voterId)}** → ${nameOf(game, targetId)}`);
  return `🐺 **Đêm ${game.dayNumber} — Bầy Sói**\nCả bầy cùng chọn 1 người để cắn.\n\n${lines.length ? lines.join('\n') : '_(chưa ai vote)_'}`;
}

async function checkAndPromptWitch(client, game) {
  if (game.night.witchPrompted) return;
  const witch = engine.getPlayerByRole(game, 'PHU_THUY');
  if (!witch) return;
  const wolves = [...game.players.values()].filter((p) => p.isAlive && p.faction === FACTION.WOLF);
  const allWolvesVoted = wolves.length === 0 || wolves.every((w) => game.night.wolfVotes.has(w.userId));
  if (!allWolvesVoted) return;

  game.night.witchPrompted = true;

  if (witch.state.healUsed && witch.state.poisonUsed) {
    game.night.submittedUserIds.add(witch.userId);
    return;
  }

  const bonusKills = game.wolfCubBonusPending ? 2 : 1;
  const rawTargets = engine.pickTopVoted(game.night.wolfVotes, bonusKills);
  const hasVictim = rawTargets.length > 0;

  const options = [];
  if (!witch.state.healUsed && hasVictim && rawTargets.length === 1) options.push({ label: 'Cứu người bị cắn', value: 'heal' });
  if (!witch.state.poisonUsed) options.push({ label: 'Dùng độc giết 1 người khác', value: 'poison' });
  options.push({ label: 'Không làm gì', value: 'skip' });

  const menu = new StringSelectMenuBuilder().setCustomId('sw_witch_choice').setPlaceholder('Chọn hành động').addOptions(options);
  try {
    await sendToRoleChannel(client, game, 'PHU_THUY', witch.userId, {
      content: `🧪 <@${witch.userId}> — **Đêm ${game.dayNumber} — Phù Thủy**\n${hasVictim ? 'Đêm nay **có người bị Sói cắn**.' : 'Đêm nay **không ai bị cắn**.'} Bạn muốn làm gì?`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
  } catch (err) {
    console.error('[checkAndPromptWitch] lỗi:', err.message);
    game.night.submittedUserIds.add(witch.userId);
  }
}

async function maybeFinalizeNight(client, gameManager, game) {
  if (!gameManager.isNightComplete(game)) return;
  await resolveAndAnnounceNight(client, gameManager, game);
}

// Ghi lai LUA CHON cua tung nguoi co hanh dong dem nay (khong phai ket qua resolve),
// vd Bao Ve chon bao ve ai, Soi vote can ai (du khong trung), Tien Tri soi ai...
// Phai goi TRUOC engine.resolveNight vi sau do game.night se bi doc/xoa mot phan.
function logNightActions(game) {
  const night = game.night;
  if (!night) return;

  // Bay Soi: moi Soi vote rieng, log rieng tung nguoi (kha nang wolfVotes co nhieu Soi)
  for (const [wolfUserId, targetId] of night.wolfVotes.entries()) {
    const p = game.players.get(wolfUserId);
    game.gameLog.push({
      dayNumber: game.dayNumber, userId: wolfUserId, roleId: p ? p.roleId : null,
      text: `chọn cắn ${nameOf(game, targetId)}`,
    });
  }

  const guardHolder = engine.getPlayerByRole(game, 'BAO_VE');
  if (guardHolder && night.guardTarget !== undefined) {
    game.gameLog.push({
      dayNumber: game.dayNumber, userId: guardHolder.userId, roleId: 'BAO_VE',
      text: night.guardTarget ? `chọn bảo vệ ${nameOf(game, night.guardTarget)}` : 'không bảo vệ ai',
    });
  }

  const caveHolder = engine.getPlayerByRole(game, 'CAVE');
  if (caveHolder && night.caveTarget !== undefined) {
    game.gameLog.push({
      dayNumber: game.dayNumber, userId: caveHolder.userId, roleId: 'CAVE',
      text: night.caveTarget === 'ALONE' ? 'ngủ một mình' : `chọn ngủ cùng ${nameOf(game, night.caveTarget)}`,
    });
  }

  const seerHolder = engine.getPlayerByRole(game, 'TIEN_TRI');
  if (seerHolder && night.seerTarget) {
    game.gameLog.push({
      dayNumber: game.dayNumber, userId: seerHolder.userId, roleId: 'TIEN_TRI',
      text: `chọn soi ${nameOf(game, night.seerTarget)}`,
    });
  }

  const witchHolder = engine.getPlayerByRole(game, 'PHU_THUY');
  if (witchHolder && night.witchAction) {
    const wa = night.witchAction;
    const text = wa.type === 'heal' ? 'chọn cứu người bị cắn'
      : wa.type === 'poison' ? `chọn đầu độc ${nameOf(game, wa.targetId)}`
        : 'không dùng bình nào';
    game.gameLog.push({ dayNumber: game.dayNumber, userId: witchHolder.userId, roleId: 'PHU_THUY', text });
  }

  const wolfCurseHolder = engine.getPlayerByRole(game, 'SOI_NGUYEN');
  if (wolfCurseHolder && night.curseTarget) {
    game.gameLog.push({
      dayNumber: game.dayNumber, userId: wolfCurseHolder.userId, roleId: 'SOI_NGUYEN',
      text: `chọn nguyền ${nameOf(game, night.curseTarget)}`,
    });
  }

  const cupidHolder = engine.getPlayerByRole(game, 'CUPID');
  if (cupidHolder && night.cupidTargets) {
    game.gameLog.push({
      dayNumber: game.dayNumber, userId: cupidHolder.userId, roleId: 'CUPID',
      text: `chọn ghép cặp ${nameOf(game, night.cupidTargets[0])} 💞 ${nameOf(game, night.cupidTargets[1])}`,
    });
  }

  const hunterHolder = engine.getPlayerByRole(game, 'THO_SAN');
  if (hunterHolder && hunterHolder.state.hunterTarget && night.submittedUserIds.has(hunterHolder.userId)) {
    game.gameLog.push({
      dayNumber: game.dayNumber, userId: hunterHolder.userId, roleId: 'THO_SAN',
      text: `chọn trước mục tiêu ${nameOf(game, hunterHolder.state.hunterTarget)} (nếu Thợ Săn chết)`,
    });
  }
}

// Gui rieng cho HOST (DM) toan bo lua chon rieng tu cua Bao Ve va Cave dem nay - 2 vai nay
// chi co 1 nguoi giu va lua chon rat "im lang" (khong co tally cong khai nhu vote Soi), nen
// host de bi mu thong tin neu khong tu vao tung thread rieng doc lai. Goi TRUOC khi resolve
// (dung gia tri goc, chua bi anh huong boi Cave vo hieu hoa) de host thay dung y dinh that.
async function sendHostNightRecap(client, game) {
  const night = game.night;
  if (!night) return;

  const lines = [];
  const guardHolder = engine.getPlayerByRole(game, 'BAO_VE');
  if (guardHolder && night.guardTarget !== undefined) {
    lines.push(`🛡️ **${nameOf(game, guardHolder.userId)}** (Bảo Vệ) chọn: ${night.guardTarget ? `bảo vệ **${nameOf(game, night.guardTarget)}**` : 'không bảo vệ ai'}`);
  }
  const caveHolder = engine.getPlayerByRole(game, 'CAVE');
  if (caveHolder && night.caveTarget !== undefined) {
    lines.push(`🕊️ **${nameOf(game, caveHolder.userId)}** (Cave) chọn: ${night.caveTarget === 'ALONE' ? 'ngủ một mình' : `ngủ cùng **${nameOf(game, night.caveTarget)}**`}`);
  }

  if (!lines.length) return; // dem nay khong co Bao Ve/Cave hoac ho chua chon gi ca (vd bi bo qua/da chet)

  try {
    const host = await client.users.fetch(game.hostId);
    await host.send(`🕵️ **Tóm tắt riêng cho Host — Đêm ${game.dayNumber}**\n${lines.join('\n')}`);
  } catch (err) {
    console.error('[sendHostNightRecap] không DM được host (có thể host tắt DM):', err.message);
  }
}

async function resolveAndAnnounceNight(client, gameManager, game) {
  // Chan re-entrancy: neu 2 su kien gan nhau (vd 2 vai tro submit gan nhu cung luc, hoac
  // host bam "Bo Qua" dung luc dem vua du dieu kien resolve) cung goi ham nay, chi cho
  // DUY NHAT 1 lan thuc su chay - tranh nhan doi tin nhan / nhay 2 lan sang ngay/dem ke tiep.
  if (game._resolvingPhase) return;
  game._resolvingPhase = true;
  try {
    await disableNightPrompts(client, game);
    logNightActions(game);
    await sendHostNightRecap(client, game);
    const result = engine.resolveNight(game);

    for (const entry of result.log) {
      const p = game.players.get(entry.userId);
      game.gameLog.push({ dayNumber: game.dayNumber, userId: entry.userId, roleId: p ? p.roleId : null, text: entry.text });
    }

    const seerHolder = engine.getPlayerByRoleAny(game, 'TIEN_TRI');
    for (const r of result.seerResults) {
      const text = `Kết quả soi: **${nameOf(game, r.userId)}** ${r.isWolf ? '**LÀ** phe Sói.' : '**KHÔNG PHẢI** phe Sói.'}`;
      if (seerHolder) {
        sendToRoleChannel(client, game, 'TIEN_TRI', seerHolder.userId, { content: `🔮 ${text}` }).catch(() => {});
        game.gameLog.push({
          dayNumber: game.dayNumber, userId: seerHolder.userId, roleId: 'TIEN_TRI',
          text: `soi ra ${nameOf(game, r.userId)}: ${r.isWolf ? 'LÀ Sói' : 'KHÔNG PHẢI Sói'}`,
        });
      }
    }

    for (const userId of result.convertedBanSoi) {
      await addPlayerToRoleThread(client, game, 'WOLVES', userId).catch(() => {});
    }

    const deathNames = result.deaths.map((d) => nameOf(game, d.userId));
    const deathText = deathNames.length
      ? deathNames.map((n) => `💀 **${n}** đã chết.`).join('\n')
      : '☀️ Đêm qua không ai chết.';
    await channelSend(client, game.channelId, `☀️ **Ngày ${game.dayNumber}**\n${deathText}`);

    const winner = engine.checkWinner(game);
    if (winner) {
      await endGame(client, gameManager, game, winner);
      return;
    }

    game.phase = 'DAY_DISCUSS';
    gameManager._persist(game);
    await postOrBumpControlPanel(client, game);
    await channelSend(client, game.channelId, `💬 Mọi người thảo luận. Host bấm **Mở Vote** trên bảng điều khiển khi sẵn sàng.`);
  } finally {
    game._resolvingPhase = false;
  }
}

// ============ DAY VOTE ============

function buildDayVoteRow(game) {
  const alive = [...game.players.values()].filter((p) => p.isAlive);
  const options = alive.map((p) => ({ label: nameOf(game, p.userId), value: p.userId })).concat([{ label: 'Không treo ai', value: 'NONE', emoji: '🚫' }]);
  const menu = new StringSelectMenuBuilder().setCustomId('sw_day_vote').setPlaceholder('Chọn người để treo cổ').addOptions(options);
  return new ActionRowBuilder().addComponents(menu);
}

// Dung lai chinh xac object `game` con dang active trong GameManager (khong phai ban cu bi cancel/thay
// the) va van dang trong DAY_VOTE - tu dung neu khong con dung, khong can flow.js goi dep tu ben ngoai.
function stopVoteBump(game) {
  if (game.voteBumpTimer) {
    clearInterval(game.voteBumpTimer);
    game.voteBumpTimer = null;
  }
}

async function bumpVoteMessage(client, gameManager, game) {
  const stillVoting = gameManager.getGame(game.guildId) === game && game.phase === 'DAY_VOTE';
  if (!stillVoting) {
    stopVoteBump(game);
    return;
  }
  if (game.voteChannelId && game.voteMessageId) {
    try {
      const oldChannel = await client.channels.fetch(game.voteChannelId);
      const oldMsg = await oldChannel.messages.fetch(game.voteMessageId);
      await oldMsg.delete();
    } catch { /* tin cu co the da bi xoa hoac khong tim thay, bo qua */ }
  }
  try {
    const msg = await channelSend(client, game.channelId, {
      embeds: [buildVoteTallyEmbed(game)],
      components: [buildDayVoteRow(game)],
    });
    game.voteChannelId = game.channelId;
    game.voteMessageId = msg.id;
  } catch (err) {
    console.error('[bumpVoteMessage] lỗi gửi lại bảng vote:', err.message);
  }
}

function startVoteBump(client, gameManager, game) {
  stopVoteBump(game);
  game.voteBumpTimer = setInterval(() => {
    bumpVoteMessage(client, gameManager, game).catch((err) => console.error('[voteBump] lỗi:', err.message));
  }, 5000);
}

async function openDayVote(client, gameManager, game) {
  gameManager.beginDayVote(game);
  await cacheDisplayNames(client, game);
  const msg = await channelSend(client, game.channelId, {
    embeds: [buildVoteTallyEmbed(game)],
    components: [buildDayVoteRow(game)],
  });
  game.voteChannelId = game.channelId;
  game.voteMessageId = msg.id;
  startVoteBump(client, gameManager, game);
  await refreshControlPanelInPlace(client, game);
}

function buildVoteTallyEmbed(game) {
  const tally = new Map();
  for (const target of game.dayVotes.values()) {
    const key = target || 'NONE';
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  const lines = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([userId, count]) => `**${userId === 'NONE' ? 'Không treo ai' : nameOf(game, userId)}** — ${count} phiếu`);
  return new EmbedBuilder()
    .setTitle('🗳️ Bỏ Phiếu Treo Cổ')
    .setDescription('Chọn người bạn nghi ngờ là Sói, hoặc "Không treo ai".')
    .addFields({ name: 'Kết quả hiện tại', value: lines.length ? lines.join('\n') : 'Chưa có ai vote.' });
}

async function maybeFinalizeDayVote(client, gameManager, game) {
  if (!gameManager.isDayVoteComplete(game)) return false;
  await resolveAndAnnounceDayVote(client, gameManager, game);
  return true;
}

async function resolveAndAnnounceDayVote(client, gameManager, game) {
  // Cung 1 co chan re-entrancy nhu resolveAndAnnounceNight (2 phase khong bao gio chay dong thoi
  // nen dung chung 1 co la an toan) - tranh treo co/thong bao ngay 2 lan neu 2 su kien gan nhau.
  if (game._resolvingPhase) return;
  game._resolvingPhase = true;
  try {
    stopVoteBump(game);
    const result = engine.resolveDayVote(game);

    if (result.log) {
      for (const entry of result.log) {
        const p = game.players.get(entry.userId);
        game.gameLog.push({ dayNumber: game.dayNumber, userId: entry.userId, roleId: p ? p.roleId : null, text: entry.text });
      }
    }

    if (!result.lynchedUserId) {
      let reason;
      if (result.tie) reason = '⚖️ Phiếu bầu hòa nhau — không ai bị treo cổ hôm nay.';
      else if (result.notEnough) reason = '🗳️ Không ai đạt quá bán số người còn sống — không ai bị treo cổ hôm nay.';
      else reason = '🗳️ Không có phiếu hợp lệ / mọi người chọn không treo ai — không ai bị treo cổ hôm nay.';
      await channelSend(client, game.channelId, reason);
    } else {
      await channelSend(client, game.channelId, `⚰️ **${nameOf(game, result.lynchedUserId)}** đã bị dân làng treo cổ.`);
      if (result.extraDeaths && result.extraDeaths.length) {
        const extraNames = result.extraDeaths.map((d) => nameOf(game, d.userId));
        await channelSend(client, game.channelId, extraNames.map((n) => `💀 **${n}** cũng chết theo.`).join('\n'));
      }
    }

    if (result.foolWins) {
      await endGame(client, gameManager, game, 'FOOL', { extraWinnerUserId: result.lynchedUserId });
      return;
    }

    const winner = engine.checkWinner(game);
    if (winner) {
      await endGame(client, gameManager, game, winner);
      return;
    }

    game.dayNumber += 1;
    await beginNight(client, gameManager, game);
  } finally {
    game._resolvingPhase = false;
  }
}

// ============ END GAME ============

async function endGame(client, gameManager, game, winnerFaction, extra = {}) {
  stopVoteBump(game);
  game.status = 'ENDED';
  await cacheDisplayNames(client, game);

  const label = winnerFaction === FACTION.WOLF ? '🐺 PHE MA SÓI'
    : winnerFaction === FACTION.VILLAGER ? '🟢 PHE DÂN LÀNG'
      : winnerFaction === 'FOOL' ? '🤡 THẰNG NGỐ'
        : winnerFaction === 'LOVERS' ? '💞 CẶP ĐÔI CUPID'
          : String(winnerFaction);
  const plainLabel = winnerFaction === FACTION.WOLF ? 'PHE MA SÓI'
    : winnerFaction === FACTION.VILLAGER ? 'PHE DÂN LÀNG'
      : winnerFaction === 'FOOL' ? 'THẰNG NGỐ'
        : winnerFaction === 'LOVERS' ? 'CẶP ĐÔI CUPID'
          : String(winnerFaction);

  const roster = [...game.players.values()]
    .map((p) => `${p.isAlive ? '🟢' : '💀'} **${nameOf(game, p.userId)}** — ${ROLES[p.roleId].emoji} ${ROLES[p.roleId].name}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🏆 GAME KẾT THÚC — ${label} THẮNG!`)
    .setDescription(roster)
    .setColor(0xffd700);

  await channelSend(client, game.channelId, { embeds: [embed] });

  // bang tong ket dang file Excel (nguoi choi x ngay) - chi gui 1 lan luc ket thuc, khong luu lai de xem sau
  try {
    const buffer = await renderGameSummaryExcel(game, game.displayNames, plainLabel);
    const attachment = new AttachmentBuilder(buffer, { name: 'ket-qua-tran.xlsx' });
    await channelSend(client, game.channelId, { files: [attachment] });
  } catch (err) {
    console.error('[endGame] Lỗi tạo file Excel tổng kết:', err.message);
  }

  await channelSend(client, game.channelId, '_(Người chơi đã chết có thể chat lại bình thường ngay bây giờ.)_');

  // luu ket qua tran vao Postgres cho /simwolf stats va /simwolf leaderboard (fire-and-forget, khong chan flow)
  saveFinishedGame(game, winnerFaction).catch((err) => console.error('[endGame] Lỗi lưu kết quả trận:', err.message));

  await closeAllThreads(game, client);
  gameManager.cancelGame(game.guildId);
}

// Huy game GIUA TRAN (khong phai het game tu nhien co phe thang) - dung khi vd co nguoi choi
// bi disconnect va host quyet dinh khong the tiep tuc. Co the goi o BAT KY dem hoac ngay nao.
async function forceCancelGame(client, gameManager, game, canceledByUserId) {
  stopVoteBump(game);
  game.status = 'ENDED';
  await cacheDisplayNames(client, game);

  const roster = [...game.players.values()]
    .map((p) => `${p.isAlive ? '🟢' : '💀'} **${nameOf(game, p.userId)}** — ${ROLES[p.roleId].emoji} ${ROLES[p.roleId].name}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle('🛑 GAME ĐÃ BỊ HỦY GIỮA TRẬN')
    .setDescription(`Bị hủy bởi <@${canceledByUserId}> lúc **Ngày/Đêm ${game.dayNumber}**.\n\n${roster}`)
    .setColor(0x808080);

  await channelSend(client, game.channelId, { embeds: [embed] });

  // van xuat file Excel tong ket nhung log da co (den luc bi huy), de anh xem lai neu can
  try {
    const buffer = await renderGameSummaryExcel(game, game.displayNames, null, { titleOverride: `TRẬN BỊ HỦY GIỮA CHỪNG (Ngày/Đêm ${game.dayNumber})` });
    const attachment = new AttachmentBuilder(buffer, { name: 'ket-qua-tran-bi-huy.xlsx' });
    await channelSend(client, game.channelId, { files: [attachment] });
  } catch (err) {
    console.error('[forceCancelGame] Lỗi tạo file Excel tổng kết:', err.message);
  }

  await channelSend(client, game.channelId, '_(Mọi người có thể chat lại bình thường ngay bây giờ.)_');

  // luu vao Postgres nhung KHONG tinh vao win_rate/games_played cua ai (xem player_stats view trong schema.sql)
  saveCancelledGame(game).catch((err) => console.error('[forceCancelGame] Lỗi lưu kết quả trận (đã hủy):', err.message));

  await closeAllThreads(game, client);
  gameManager.cancelGame(game.guildId);
}

module.exports = {
  setupRoleThreads,
  addPlayerToRoleThread,
  closeAllThreads,
  sendRoleRevealAnnouncement,
  buildOwnRoleEmbed,
  buildFullRoleListEmbed,
  buildControlPanelEmbed,
  buildControlPanelButtons,
  postOrBumpControlPanel,
  refreshControlPanelInPlace,
  beginNight,
  buildWolfVoteTallyContent,
  checkAndPromptWitch,
  sendHostNightRecap,
  maybeFinalizeNight,
  resolveAndAnnounceNight,
  openDayVote,
  buildVoteTallyEmbed,
  bumpVoteMessage,
  stopVoteBump,
  maybeFinalizeDayVote,
  resolveAndAnnounceDayVote,
  endGame,
  forceCancelGame,
  nameOf,
  cacheDisplayNames,
  logNightActions,
};