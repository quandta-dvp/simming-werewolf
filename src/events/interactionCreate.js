const { ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { ROLES, FACTION } = require('../game/constants');
const swCommand = require('../commands/simwolf');
const flow = require('../game/flow');

const SELECTABLE_ROLES = Object.values(ROLES).filter((r) => !r.isDefaultFiller);

function replyOrFollowUp(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

async function refreshLobbyMessage(interaction, game) {
  try {
    await interaction.message.edit({
      embeds: [swCommand.buildLobbyEmbed(game)],
      components: swCommand.buildLobbyButtons(),
    });
  } catch (err) {
    console.error('Không thể refresh lobby message:', err);
  }
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, context) {
    const { commands, gameManager } = context;

    // 1. Slash commands
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction, { gameManager, flow });
      } catch (err) {
        console.error(err);
        const payload = { content: `⚠️ Lỗi: ${err.message}`, flags: MessageFlags.Ephemeral };
        await replyOrFollowUp(interaction, payload);
      }
      return;
    }

    // 2. Buttons trong lobby
    if (interaction.isButton()) {
      try {
        const game = gameManager.getGame(interaction.guildId);

        if (interaction.customId === 'sw_join') {
          gameManager.join(interaction.guildId, interaction.user.id);
          await interaction.deferUpdate();
          await refreshLobbyMessage(interaction, gameManager.getGame(interaction.guildId));
          return;
        }

        if (interaction.customId === 'sw_leave') {
          gameManager.leave(interaction.guildId, interaction.user.id);
          await interaction.deferUpdate();
          await refreshLobbyMessage(interaction, gameManager.getGame(interaction.guildId));
          return;
        }

        if (interaction.customId === 'sw_view_roles') {
          await interaction.reply({ embeds: [swCommand.buildRoleListEmbed()], flags: MessageFlags.Ephemeral });
          return;
        }

        if (interaction.customId === 'sw_select_roles') {
          if (!game) {
            await interaction.reply({ content: '⚠️ Phòng đã bị đóng hoặc chưa được tạo (có thể bot vừa restart) — dùng `/simwolf create` để tạo phòng mới.', flags: MessageFlags.Ephemeral });
            return;
          }
          if (game.hostId !== interaction.user.id) {
            await interaction.reply({ content: '⛔ Chỉ host mới được chọn vai.', flags: MessageFlags.Ephemeral });
            return;
          }
          const options = SELECTABLE_ROLES.map((r) => {
            const rawDescription = `${r.faction === 'wolf' ? 'Phe Ma Sói' : r.faction === 'third_party' ? 'Phe Thứ 3' : 'Phe Dân Làng'} — ${r.description}`;
            return {
              label: r.name,
              value: r.id,
              description: rawDescription.length > 100 ? `${rawDescription.slice(0, 97)}...` : rawDescription,
              emoji: r.emoji,
              default: game.selectedRoles ? game.selectedRoles.includes(r.id) : false,
            };
          });
          const menu = new StringSelectMenuBuilder()
            .setCustomId('sw_role_select')
            .setPlaceholder('Chọn các role muốn đưa vào ván này')
            .setMinValues(0)
            .setMaxValues(options.length)
            .addOptions(options);
          await interaction.reply({
            content: 'Chọn role cho ván này (phần còn lại sẽ tự động là Dân Thường / Sói Thường theo tỉ lệ mặc định):',
            components: [new ActionRowBuilder().addComponents(menu)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (interaction.customId === 'sw_start') {
          const started = gameManager.startGame(interaction.guildId, interaction.user.id);
          await interaction.reply('▶️ Game bắt đầu! Đang random vai trò và nhắn tin riêng cho từng người...');
          await flow.beginNight(interaction.client, gameManager, started);
          return;
        }

        if (interaction.customId === 'sw_status') {
          if (!game) {
            await interaction.reply({ content: '⚠️ Không có phòng nào đang mở.', flags: MessageFlags.Ephemeral });
            return;
          }
          const alive = [...game.players.values()].filter((p) => p.isAlive).length;
          await interaction.reply({
            content: `📄 **Trạng thái:** ${game.status}\n🗓️ Ngày: ${game.dayNumber || 0} — Phase: ${game.phase || 'Chưa bắt đầu'}\n👥 Người chơi còn sống: ${alive}/${game.players.size}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (interaction.customId === 'sw_cancel') {
          if (!game) {
            await interaction.reply({ content: '⚠️ Không có phòng nào đang mở.', flags: MessageFlags.Ephemeral });
            return;
          }
          if (game.hostId !== interaction.user.id) {
            await interaction.reply({ content: '⛔ Chỉ host mới được hủy phòng.', flags: MessageFlags.Ephemeral });
            return;
          }
          gameManager.cancelGame(interaction.guildId);
          await interaction.reply('🗑️ Phòng đã được hủy.');
          return;
        }
      } catch (err) {
        console.error('[Button interaction error]', err);
        try {
          await replyOrFollowUp(interaction, { content: `⚠️ Đã có lỗi xảy ra: ${err.message}`, flags: MessageFlags.Ephemeral });
        } catch (replyErr) {
          console.error('[Failed to notify user of button error]', replyErr);
        }
      }
      return;
    }

    // 3. Select menu
    if (interaction.isStringSelectMenu()) {
      try {
        // 3a. Host chon vai trong lobby (trong guild)
        if (interaction.customId === 'sw_role_select') {
          gameManager.setSelectedRoles(interaction.guildId, interaction.user.id, interaction.values);
          await interaction.update({ content: `✅ Đã chọn: ${interaction.values.map((v) => ROLES[v].name).join(', ') || '(không có, dùng mặc định)'}`, components: [] });
          const game = gameManager.getGame(interaction.guildId);
          const lobbyMsg = await interaction.channel.messages.fetch({ limit: 20 })
            .then((msgs) => msgs.find((m) => m.author.id === interaction.client.user.id && m.embeds[0]?.title?.includes('PHÒNG CHỜ')));
          if (lobbyMsg) {
            await lobbyMsg.edit({ embeds: [swCommand.buildLobbyEmbed(game)], components: swCommand.buildLobbyButtons() });
          }
          return;
        }

        // 3b. Cac select menu con lai deu den tu DM (night action) hoac message cong khai (day vote)
        const game = interaction.guildId
          ? gameManager.getGame(interaction.guildId)
          : gameManager.getGameByPlayer(interaction.user.id);

        if (!game) {
          await interaction.reply({ content: '⚠️ Không tìm thấy game đang chạy (có thể đã kết thúc hoặc bot vừa restart).', flags: MessageFlags.Ephemeral });
          return;
        }

        const targetId = interaction.values[0];

        if (interaction.customId === 'sw_seer_pick') {
          gameManager.submitSeerTarget(game, interaction.user.id, targetId);
          await interaction.update({ content: `🔮 Đã ghi nhận. Kết quả sẽ được gửi cho bạn cuối đêm.`, components: [] });
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_guard_pick') {
          gameManager.submitGuardTarget(game, interaction.user.id, targetId);
          await interaction.update({ content: '🛡️ Đã ghi nhận lựa chọn bảo vệ.', components: [] });
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_cave_pick') {
          gameManager.submitCaveTarget(game, interaction.user.id, targetId);
          await interaction.update({ content: '🕊️ Đã ghi nhận lựa chọn ngủ cùng.', components: [] });
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_wolf_vote') {
          gameManager.submitWolfVote(game, interaction.user.id, targetId);
          await interaction.update({ content: '🐺 Đã ghi nhận lựa chọn cắn.', components: [] });
          await flow.checkAndPromptWitch(interaction.client, game);
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_curse_pick') {
          const chosen = interaction.values[0] || null;
          gameManager.submitCurseTarget(game, interaction.user.id, chosen);
          await interaction.update({ content: chosen ? '☠️ Đã ghi nhận lựa chọn nguyền.' : '☠️ Bạn chọn không nguyền ai đêm nay.', components: [] });
          return;
        }

        if (interaction.customId === 'sw_witch_choice') {
          const choice = interaction.values[0];
          if (choice === 'poison') {
            const options = [...game.players.values()]
              .filter((p) => p.isAlive)
              .slice(0, 25)
              .map((p) => ({ label: flow.nameOf(game, p.userId), value: p.userId }));
            const menu = new StringSelectMenuBuilder().setCustomId('sw_witch_poison_target').setPlaceholder('Chọn người để đầu độc').addOptions(options);
            await interaction.update({ content: '🧪 Chọn người bạn muốn đầu độc:', components: [new ActionRowBuilder().addComponents(menu)] });
            return;
          }
          if (choice === 'heal') {
            const bonusKills = game.wolfCubBonusPending ? 2 : 1;
            const rawTargets = require('../game/engine').pickTopVoted(game.night.wolfVotes, bonusKills);
            gameManager.submitWitchAction(game, interaction.user.id, { type: 'heal', targetId: rawTargets[0] });
          } else {
            gameManager.submitWitchAction(game, interaction.user.id, { type: 'skip' });
          }
          await interaction.update({ content: '🧪 Đã ghi nhận quyết định của Phù Thủy.', components: [] });
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_witch_poison_target') {
          gameManager.submitWitchAction(game, interaction.user.id, { type: 'poison', targetId });
          await interaction.update({ content: '🧪 Đã ghi nhận quyết định của Phù Thủy.', components: [] });
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_hunter_shoot') {
          const target = game.players.get(targetId);
          if (target && target.isAlive) {
            target.isAlive = false;
            await interaction.update({ content: `🏹 Bạn đã bắn chết ${flow.nameOf(game, targetId)} trước khi nhắm mắt.`, components: [] });
            await flow.cacheDisplayNames(interaction.client, game);
            await interaction.channel.send(`🏹 Trước khi chết, Thợ Săn đã bắn theo **${flow.nameOf(game, targetId)}**.`).catch(() => {});
            const winner = require('../game/engine').checkWinner(game);
            if (winner) await flow.endGame(interaction.client, gameManager, game, winner);
          } else {
            await interaction.update({ content: '⚠️ Mục tiêu không còn hợp lệ.', components: [] });
          }
          return;
        }

        if (interaction.customId === 'sw_day_vote') {
          gameManager.submitDayVote(game, interaction.user.id, targetId);
          await interaction.update({ embeds: [flow.buildVoteTallyEmbed(game)], components: interaction.message.components });
          await flow.maybeFinalizeDayVote(interaction.client, gameManager, game);
          return;
        }
      } catch (err) {
        console.error('[Select menu interaction error]', err);
        try {
          await replyOrFollowUp(interaction, { content: `⚠️ ${err.message}`, flags: MessageFlags.Ephemeral });
        } catch (replyErr) {
          console.error('[Failed to notify user of select menu error]', replyErr);
        }
      }
    }
  },
};
