const {
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType,
} = require('discord.js');
const { ROLES, FACTION } = require('./constants');
const { GameManager } = require('./GameManager');
const engine = require('./engine');

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
    const group = GameManager.threadGroupOf(p.roleId);
    if (!group) continue;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(p);
  }

  const groupLabel = {
    TIEN_TRI: '🔮-tien-tri', BAO_VE: '🛡️-bao-ve', PHU_THUY: '🧪-phu-thuy', CAVE: '🕊️-cave', WOLVES: '🐺-bay-soi',
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
  return [row1, row2];
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
  const group = GameManager.threadGroupOf(roleId);

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

  if (roleId === 'SOI_THUONG' || roleId === 'SOI_NGUYEN' || roleId === 'SOI_CON') {
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
  const names = rawTargets.length ? rawTargets.map((id) => nameOf(game, id)).join(', ') : 'không ai';

  const options = [];
  if (!witch.state.healUsed && rawTargets.length === 1) options.push({ label: `Cứu ${names}`, value: 'heal' });
  if (!witch.state.poisonUsed) options.push({ label: 'Dùng độc giết 1 người khác', value: 'poison' });
  options.push({ label: 'Không làm gì', value: 'skip' });

  const menu = new StringSelectMenuBuilder().setCustomId('sw_witch_choice').setPlaceholder('Chọn hành động').addOptions(options);
  try {
    await sendToRoleChannel(client, game, 'PHU_THUY', witch.userId, {
      content: `🧪 <@${witch.userId}> — **Đêm ${game.dayNumber} — Phù Thủy**\nĐêm nay **${names}** bị Sói cắn. Bạn muốn làm gì?`,
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

async function resolveAndAnnounceNight(client, gameManager, game) {
  await disableNightPrompts(client, game);
  const result = engine.resolveNight(game);

  const seerHolder = engine.getPlayerByRole(game, 'TIEN_TRI');
  for (const r of result.seerResults) {
    const text = r.noResult
      ? 'Bạn cảm thấy mơ màng đêm nay, không có kết quả soi.'
      : `Kết quả soi: **${nameOf(game, r.userId)}** ${r.isWolf ? '**LÀ** phe Sói.' : '**KHÔNG PHẢI** phe Sói.'}`;
    if (seerHolder) {
      sendToRoleChannel(client, game, 'TIEN_TRI', seerHolder.userId, { content: `🔮 ${text}` }).catch(() => {});
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
  await postOrBumpControlPanel(client, game);
  await channelSend(client, game.channelId, `💬 Mọi người thảo luận. Host bấm **Mở Vote** trên bảng điều khiển khi sẵn sàng.`);
}

// ============ DAY VOTE ============

async function openDayVote(client, gameManager, game) {
  gameManager.beginDayVote(game);
  await cacheDisplayNames(client, game);
  const alive = gameManager.getAlivePlayers(game);
  const options = alive.map((p) => ({ label: nameOf(game, p.userId), value: p.userId })).concat([{ label: 'Không treo ai', value: 'NONE', emoji: '🚫' }]);
  const embed = new EmbedBuilder()
    .setTitle('🗳️ Bỏ Phiếu Treo Cổ')
    .setDescription('Chọn người bạn nghi ngờ là Sói, hoặc "Không treo ai".')
    .addFields({ name: 'Kết quả hiện tại', value: 'Chưa có ai vote.' });
  const menu = new StringSelectMenuBuilder().setCustomId('sw_day_vote').setPlaceholder('Chọn người để treo cổ').addOptions(options);
  await channelSend(client, game.channelId, { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
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
  const result = engine.resolveDayVote(game);

  if (!result.lynchedUserId) {
    await channelSend(client, game.channelId, result.tie ? '⚖️ Phiếu bầu hòa nhau — không ai bị treo cổ hôm nay.' : '🗳️ Không đủ phiếu / chọn không treo ai — không ai bị treo cổ hôm nay.');
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
}

// ============ END GAME ============

async function endGame(client, gameManager, game, winnerFaction, extra = {}) {
  game.status = 'ENDED';
  await cacheDisplayNames(client, game);

  const label = winnerFaction === FACTION.WOLF ? '🐺 PHE MA SÓI'
    : winnerFaction === FACTION.VILLAGER ? '🟢 PHE DÂN LÀNG'
      : winnerFaction === 'FOOL' ? '🤡 THẰNG NGỐ'
        : String(winnerFaction);

  const roster = [...game.players.values()]
    .map((p) => `${p.isAlive ? '🟢' : '💀'} **${nameOf(game, p.userId)}** — ${ROLES[p.roleId].emoji} ${ROLES[p.roleId].name}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🏆 GAME KẾT THÚC — ${label} THẮNG!`)
    .setDescription(roster)
    .setColor(0xffd700);

  await channelSend(client, game.channelId, { embeds: [embed] });
  await channelSend(client, game.channelId, '_(Người chơi đã chết có thể chat lại bình thường ngay bây giờ.)_');

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
  maybeFinalizeNight,
  resolveAndAnnounceNight,
  openDayVote,
  buildVoteTallyEmbed,
  maybeFinalizeDayVote,
  resolveAndAnnounceDayVote,
  endGame,
  nameOf,
  cacheDisplayNames,
};
