const { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { ROLES, FACTION } = require('./constants');
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
    .slice(0, 25) // gioi han cua Discord select menu
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

// ============ NIGHT ============

async function beginNight(client, gameManager, game) {
  gameManager.beginNightState(game);
  await cacheDisplayNames(client, game);

  const actors = gameManager.getNightActors(game);
  for (const player of actors) {
    if (player.roleId === 'PHU_THUY') continue; // Phu Thuy duoc nhan tin rieng sau khi Soi vote xong
    try {
      await sendNightPrompt(client, game, player);
    } catch (err) {
      console.error(`[beginNight] Không gửi được DM cho ${player.userId}:`, err.message);
    }
  }

  await channelSend(client, game.channelId, `🌙 **Đêm ${game.dayNumber}** bắt đầu — mọi người đi ngủ. Các vai trò có chức năng đang nhận tin nhắn riêng từ bot.\n_Host có thể dùng lệnh \`/simwolf endnight\` nếu chờ quá lâu._`);
}

async function sendNightPrompt(client, game, player) {
  const roleId = player.roleId;

  if (roleId === 'TIEN_TRI') {
    const options = aliveOptions(game, { excludeUserId: player.userId });
    if (!options.length) return;
    const menu = new StringSelectMenuBuilder().setCustomId('sw_seer_pick').setPlaceholder('Chọn người để soi').addOptions(options);
    await dmUser(client, player.userId, {
      content: `🔮 **Đêm ${game.dayNumber} — Tiên Tri**\nChọn 1 người để soi phe:`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
    return;
  }

  if (roleId === 'BAO_VE') {
    const options = aliveOptions(game).concat([{ label: 'Không bảo vệ ai đêm nay', value: 'SKIP' }]);
    const menu = new StringSelectMenuBuilder().setCustomId('sw_guard_pick').setPlaceholder('Chọn người để bảo vệ').addOptions(options);
    await dmUser(client, player.userId, {
      content: `🛡️ **Đêm ${game.dayNumber} — Bảo Vệ**\nChọn 1 người để bảo vệ khỏi Sói (không được trùng người đêm trước):`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
    return;
  }

  if (roleId === 'CAVE') {
    const options = aliveOptions(game, { excludeUserId: player.userId }).concat([{ label: 'Ngủ một mình', value: 'ALONE' }]);
    const menu = new StringSelectMenuBuilder().setCustomId('sw_cave_pick').setPlaceholder('Chọn người để ngủ cùng').addOptions(options);
    await dmUser(client, player.userId, {
      content: `🕊️ **Đêm ${game.dayNumber} — Cave**\nChọn người để ngủ cùng đêm nay (không trùng người đêm trước):`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
    return;
  }

  if (roleId === 'SOI_THUONG' || roleId === 'SOI_NGUYEN' || roleId === 'SOI_CON') {
    const options = aliveOptions(game, { excludeFaction: FACTION.WOLF });
    const menu = new StringSelectMenuBuilder().setCustomId('sw_wolf_vote').setPlaceholder('Chọn người để cắn').addOptions(options);
    const extra = game.wolfCubBonusPending ? '\n🐾 *Sói Con đã hy sinh — đêm nay bầy được cắn 2 người!*' : '';
    await dmUser(client, player.userId, {
      content: `🐺 **Đêm ${game.dayNumber} — Bầy Sói**\nChọn 1 người để cắn (không thể cắn đồng đội):${extra}`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
    if (roleId === 'SOI_NGUYEN') {
      const curseOptions = aliveOptions(game, { excludeFaction: FACTION.WOLF });
      const curseMenu = new StringSelectMenuBuilder().setCustomId('sw_curse_pick').setPlaceholder('(Tùy chọn) Nguyền ai đó').setMinValues(0).setMaxValues(1).addOptions(curseOptions);
      await dmUser(client, player.userId, {
        content: '☠️ **Sói Nguyền** — (Tùy chọn) chọn 1 người để nguyền, người này khi bị Tiên Tri soi sẽ luôn hiện ra là Sói:',
        components: [new ActionRowBuilder().addComponents(curseMenu)],
      });
    }
  }
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
    await dmUser(client, witch.userId, {
      content: `🧪 **Đêm ${game.dayNumber} — Phù Thủy**\nĐêm nay **${names}** bị Sói cắn. Bạn muốn làm gì?`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
  } catch (err) {
    console.error('[checkAndPromptWitch] Không gửi được DM cho Phù Thủy:', err.message);
    game.night.submittedUserIds.add(witch.userId);
  }
}

async function maybeFinalizeNight(client, gameManager, game) {
  if (!gameManager.isNightComplete(game)) return;
  await resolveAndAnnounceNight(client, gameManager, game);
}

async function resolveAndAnnounceNight(client, gameManager, game) {
  const result = engine.resolveNight(game);

  // DM ket qua Tien Tri
  for (const r of result.seerResults) {
    const text = r.noResult
      ? 'Bạn cảm thấy mơ màng đêm nay, không có kết quả soi.'
      : `Kết quả soi: **${nameOf(game, r.userId)}** ${r.isWolf ? '**LÀ** phe Sói.' : '**KHÔNG PHẢI** phe Sói.'}`;
    dmUser(client, engine.getPlayerByRole(game, 'TIEN_TRI')?.userId, { content: `🔮 ${text}` }).catch(() => {});
  }

  // Thong bao ngay - chi noi ai chet, khong lo role
  const deathNames = result.deaths.map((d) => nameOf(game, d.userId));
  const deathText = deathNames.length
    ? deathNames.map((n) => `💀 **${n}** đã chết.`).join('\n')
    : '☀️ Đêm qua không ai chết.';
  await channelSend(client, game.channelId, `☀️ **Ngày ${game.dayNumber}**\n${deathText}`);

  await handleHunterTriggers(client, game, result.hunterTriggerUserIds);

  const winner = engine.checkWinner(game);
  if (winner) {
    await endGame(client, gameManager, game, winner);
    return;
  }

  await openDayVote(client, gameManager, game);
}

async function handleHunterTriggers(client, game, hunterUserIds) {
  for (const userId of hunterUserIds) {
    const options = aliveOptions(game, { excludeUserId: userId });
    if (!options.length) continue;
    const menu = new StringSelectMenuBuilder().setCustomId('sw_hunter_shoot').setPlaceholder('Chọn người để bắn theo').addOptions(options);
    try {
      await dmUser(client, userId, {
        content: '🏹 Bạn vừa chết! Trước khi nhắm mắt, chọn 1 người để bắn chết theo:',
        components: [new ActionRowBuilder().addComponents(menu)],
      });
    } catch (err) {
      console.error('[handleHunterTriggers] Không gửi được DM cho Thợ Săn:', err.message);
    }
  }
}

// ============ DAY VOTE ============

async function openDayVote(client, gameManager, game) {
  gameManager.beginDayVote(game);
  await cacheDisplayNames(client, game);
  const alive = gameManager.getAlivePlayers(game);
  const options = alive.map((p) => ({ label: nameOf(game, p.userId), value: p.userId }));
  const embed = new EmbedBuilder()
    .setTitle('🗳️ Bỏ Phiếu Treo Cổ')
    .setDescription('Chọn người bạn nghi ngờ là Sói. Vote sẽ tự chốt khi mọi người đã bỏ phiếu.')
    .addFields({ name: 'Kết quả hiện tại', value: 'Chưa có ai vote.' });
  const menu = new StringSelectMenuBuilder().setCustomId('sw_day_vote').setPlaceholder('Chọn người để treo cổ').addOptions(options);
  await channelSend(client, game.channelId, { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
}

function buildVoteTallyEmbed(game) {
  const tally = new Map();
  for (const target of game.dayVotes.values()) {
    if (!target) continue;
    tally.set(target, (tally.get(target) || 0) + 1);
  }
  const lines = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([userId, count]) => `**${nameOf(game, userId)}** — ${count} phiếu`);
  return new EmbedBuilder()
    .setTitle('🗳️ Bỏ Phiếu Treo Cổ')
    .setDescription('Chọn người bạn nghi ngờ là Sói. Vote sẽ tự chốt khi mọi người đã bỏ phiếu.')
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
    await channelSend(client, game.channelId, result.tie ? '⚖️ Phiếu bầu hòa nhau — không ai bị treo cổ hôm nay.' : '🗳️ Không đủ phiếu — không ai bị treo cổ hôm nay.');
  } else {
    await channelSend(client, game.channelId, `⚰️ **${nameOf(game, result.lynchedUserId)}** đã bị dân làng treo cổ.`);
  }

  if (result.foolWins) {
    await endGame(client, gameManager, game, 'FOOL', { extraWinnerUserId: result.lynchedUserId });
    return;
  }

  if (result.hunterTriggered) {
    await handleHunterTriggers(client, game, [result.hunterTriggered]);
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
  await channelSend(client, game.channelId, '_(Người chơi đã chết có thể chat lại bình thường ngay bây giờ — bot chưa tự động mở quyền kênh, đây là việc cần làm ở bước tiếp theo.)_');

  gameManager.cancelGame(game.guildId);
}

module.exports = {
  beginNight,
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
