const { ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { ROLES, FACTION } = require('../game/constants');
const swCommand = require('../commands/simwolf');
const flow = require('../game/flow');
const engine = require('../game/engine');

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

// Kiem tra nguoi bam co dung la nguoi giu role nay khong (host cung o trong thread nhung chi de xem)
function requireRoleHolder(game, roleId, userId) {
  const player = game.players.get(userId);
  if (!player || !player.isAlive || player.roleId !== roleId) {
    throw new Error('Bạn không phải người giữ vai trò này (host chỉ xem được, không thao tác).');
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

    // 2. Buttons
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
            await interaction.reply({ content: '⚠️ Phòng đã bị đóng hoặc chưa được tạo — dùng `/simwolf create` để tạo phòng mới.', flags: MessageFlags.Ephemeral });
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
          await interaction.reply('▶️ Game bắt đầu! Đang random vai trò, tạo thread riêng và gửi thông báo...');
          await flow.sendRoleRevealAnnouncement(interaction.client, started);
          await flow.setupRoleThreads(interaction.client, started);
          await flow.postOrBumpControlPanel(interaction.client, started);
          await flow.beginNight(interaction.client, gameManager, started);
          return;
        }

        if (interaction.customId === 'sw_show_role') {
          if (!game || game.status !== 'RUNNING') {
            await interaction.reply({ content: '⚠️ Game chưa bắt đầu hoặc đã kết thúc.', flags: MessageFlags.Ephemeral });
            return;
          }
          if (interaction.user.id === game.hostId) {
            await interaction.reply({ embeds: [flow.buildFullRoleListEmbed(game)], flags: MessageFlags.Ephemeral });
            return;
          }
          const player = game.players.get(interaction.user.id);
          if (!player) {
            await interaction.reply({ content: '⚠️ Bạn không tham gia ván này.', flags: MessageFlags.Ephemeral });
            return;
          }
          await interaction.reply({ embeds: [flow.buildOwnRoleEmbed(game, player)], flags: MessageFlags.Ephemeral });
          return;
        }

        if (interaction.customId === 'sw_panel_bump') {
          if (!game) {
            await interaction.reply({ content: '⚠️ Không có game nào đang chạy.', flags: MessageFlags.Ephemeral });
            return;
          }
          await interaction.deferUpdate();
          await flow.postOrBumpControlPanel(interaction.client, game);
          return;
        }

        if (interaction.customId === 'sw_panel_skip') {
          if (!game || game.hostId !== interaction.user.id) {
            await interaction.reply({ content: '⛔ Chỉ host mới được bỏ qua đêm/ngày.', flags: MessageFlags.Ephemeral });
            return;
          }
          await interaction.deferUpdate();
          if (game.phase === 'NIGHT') {
            await flow.resolveAndAnnounceNight(interaction.client, gameManager, game);
          } else if (game.phase === 'DAY_VOTE') {
            for (const p of gameManager.getAlivePlayers(game)) {
              if (!game.dayVotes.has(p.userId)) game.dayVotes.set(p.userId, null);
            }
            await flow.resolveAndAnnounceDayVote(interaction.client, gameManager, game);
          } else {
            await interaction.followUp({ content: 'ℹ️ Đang trong lúc thảo luận — dùng nút **Mở Vote** để chuyển sang bỏ phiếu.', flags: MessageFlags.Ephemeral });
          }
          return;
        }

        if (interaction.customId === 'sw_panel_open_vote') {
          if (!game || game.hostId !== interaction.user.id) {
            await interaction.reply({ content: '⛔ Chỉ host mới được mở vote.', flags: MessageFlags.Ephemeral });
            return;
          }
          if (game.phase !== 'DAY_DISCUSS') {
            await interaction.reply({ content: '⚠️ Hiện không phải lúc thảo luận ngày.', flags: MessageFlags.Ephemeral });
            return;
          }
          await interaction.deferUpdate();
          await flow.openDayVote(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_panel_end_vote') {
          if (!game || game.hostId !== interaction.user.id) {
            await interaction.reply({ content: '⛔ Chỉ host mới được kết thúc vote.', flags: MessageFlags.Ephemeral });
            return;
          }
          if (game.phase !== 'DAY_VOTE') {
            await interaction.reply({ content: '⚠️ Hiện không phải đang trong vote.', flags: MessageFlags.Ephemeral });
            return;
          }
          await interaction.deferUpdate();
          for (const p of gameManager.getAlivePlayers(game)) {
            if (!game.dayVotes.has(p.userId)) game.dayVotes.set(p.userId, null);
          }
          await flow.resolveAndAnnounceDayVote(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_panel_force_cancel') {
          if (!game) {
            await interaction.reply({ content: '⚠️ Không có phòng nào đang chạy.', flags: MessageFlags.Ephemeral });
            return;
          }
          if (game.hostId !== interaction.user.id) {
            await interaction.reply({ content: '⛔ Chỉ host mới được hủy game giữa trận.', flags: MessageFlags.Ephemeral });
            return;
          }
          // Duoc phep bam o BAT KY dem/ngay nao (khong check phase) - dung cho truong hop can huy khan cap
          // vd co nguoi choi bi disconnect ma game khong the tiep tuc binh thuong.
          await interaction.deferUpdate();
          await flow.forceCancelGame(interaction.client, gameManager, game, interaction.user.id);
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

        // Tat ca select menu trong game (thread) deu tra ve tu guild - khong con truong hop DM rieng nao nua
        const game = gameManager.getGame(interaction.guildId);

        if (!game) {
          await interaction.reply({ content: '⚠️ Không tìm thấy game đang chạy (có thể đã kết thúc hoặc bot vừa restart).', flags: MessageFlags.Ephemeral });
          return;
        }

        const targetId = interaction.values[0];

        if (interaction.customId === 'sw_seer_pick') {
          requireRoleHolder(game, 'TIEN_TRI', interaction.user.id);
          gameManager.submitSeerTarget(game, interaction.user.id, targetId);
          await interaction.update({ content: '🔮 Đã ghi nhận. Kết quả sẽ được gửi cuối đêm.', components: [] });
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_guard_pick') {
          requireRoleHolder(game, 'BAO_VE', interaction.user.id);
          gameManager.submitGuardTarget(game, interaction.user.id, targetId);
          await interaction.update({ content: '🛡️ Đã ghi nhận lựa chọn bảo vệ.', components: [] });
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_cave_pick') {
          requireRoleHolder(game, 'CAVE', interaction.user.id);
          gameManager.submitCaveTarget(game, interaction.user.id, targetId);
          await interaction.update({ content: '🕊️ Đã ghi nhận lựa chọn ngủ cùng.', components: [] });
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_wolf_vote') {
          gameManager.submitWolfVote(game, interaction.user.id, targetId);
          await interaction.update({ content: flow.buildWolfVoteTallyContent(game), components: interaction.message.components });
          await flow.checkAndPromptWitch(interaction.client, game);
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_curse_pick') {
          requireRoleHolder(game, 'SOI_NGUYEN', interaction.user.id);
          const chosen = interaction.values[0] || null;
          gameManager.submitCurseTarget(game, interaction.user.id, chosen);
          await interaction.update({ content: chosen ? '☠️ Đã ghi nhận lựa chọn nguyền.' : '☠️ Không nguyền ai đêm nay.', components: [] });
          return;
        }

        if (interaction.customId === 'sw_witch_choice') {
          requireRoleHolder(game, 'PHU_THUY', interaction.user.id);
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
            const rawTargets = engine.pickTopVoted(game.night.wolfVotes, bonusKills);
            gameManager.submitWitchAction(game, interaction.user.id, { type: 'heal', targetId: rawTargets[0] });
          } else {
            gameManager.submitWitchAction(game, interaction.user.id, { type: 'skip' });
          }
          await interaction.update({ content: '🧪 Đã ghi nhận quyết định của Phù Thủy.', components: [] });
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_witch_poison_target') {
          requireRoleHolder(game, 'PHU_THUY', interaction.user.id);
          gameManager.submitWitchAction(game, interaction.user.id, { type: 'poison', targetId });
          await interaction.update({ content: '🧪 Đã ghi nhận quyết định của Phù Thủy.', components: [] });
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_cupid_pick') {
          requireRoleHolder(game, 'CUPID', interaction.user.id);
          const targets = interaction.values;
          gameManager.submitCupidTargets(game, interaction.user.id, targets);
          await interaction.update({ content: `💘 Đã ghép cặp: **${flow.nameOf(game, targets[0])}** 💞 **${flow.nameOf(game, targets[1])}**.`, components: [] });
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_hunter_pick') {
          requireRoleHolder(game, 'THO_SAN', interaction.user.id);
          gameManager.submitHunterTarget(game, interaction.user.id, targetId);
          await interaction.update({ content: `🏹 Đã ghi nhận mục tiêu nhắm trước: **${flow.nameOf(game, targetId)}**.`, components: [] });
          await flow.maybeFinalizeNight(interaction.client, gameManager, game);
          return;
        }

        if (interaction.customId === 'sw_day_vote') {
          gameManager.submitDayVote(game, interaction.user.id, targetId);
          try {
            await interaction.update({ embeds: [flow.buildVoteTallyEmbed(game)], components: interaction.message.components });
          } catch (err) {
            // Bang vote co the da bi auto-bump (xoa + gui lai) trong luc nguoi nay dang chon - phieu van duoc ghi nhan binh thuong.
            console.error('[sw_day_vote] không edit được tin nhắn cũ (có thể đã bị bump), phiếu vẫn được ghi nhận:', err.message);
            await replyOrFollowUp(interaction, { content: '🗳️ Đã ghi nhận phiếu của bạn.', flags: MessageFlags.Ephemeral });
          }
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
