const { ActionRowBuilder, StringSelectMenuBuilder, InteractionResponseFlags } = require('discord.js');
const { ROLES } = require('../game/constants');
const swCommand = require('../commands/simwolf');

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
        await command.execute(interaction, { gameManager });
      } catch (err) {
        console.error(err);
        const payload = { content: `⚠️ Lỗi: ${err.message}`, flags: InteractionResponseFlags.Ephemeral };
        await replyOrFollowUp(interaction, payload);
      }
      return;
    }

    // 2. Buttons trong lobby
    if (interaction.isButton()) {
      const game = gameManager.getGame(interaction.guildId);

      if (interaction.customId === 'sw_join') {
        try {
          gameManager.join(interaction.guildId, interaction.user.id);
          await interaction.deferUpdate();
          await refreshLobbyMessage(interaction, gameManager.getGame(interaction.guildId));
        } catch (err) {
          await replyOrFollowUp(interaction, { content: `⚠️ ${err.message}`, flags: InteractionResponseFlags.Ephemeral });
        }
        return;
      }

      if (interaction.customId === 'sw_leave') {
        try {
          gameManager.leave(interaction.guildId, interaction.user.id);
          await interaction.deferUpdate();
          await refreshLobbyMessage(interaction, gameManager.getGame(interaction.guildId));
        } catch (err) {
          await replyOrFollowUp(interaction, { content: `⚠️ ${err.message}`, flags: InteractionResponseFlags.Ephemeral });
        }
        return;
      }

      if (interaction.customId === 'sw_view_roles') {
        await interaction.reply({ embeds: [swCommand.buildRoleListEmbed()], flags: InteractionResponseFlags.Ephemeral });
        return;
      }

      if (interaction.customId === 'sw_select_roles') {
        if (!game || game.hostId !== interaction.user.id) {
          await interaction.reply({ content: '⛔ Chỉ host mới được chọn vai.', flags: InteractionResponseFlags.Ephemeral });
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
          flags: InteractionResponseFlags.Ephemeral,
        });
        return;
      }

      if (interaction.customId === 'sw_start') {
        try {
          gameManager.startGame(interaction.guildId, interaction.user.id);
          await interaction.reply('▶️ Game bắt đầu! Đang gửi role qua tin nhắn riêng cho từng người chơi... (logic gửi DM + night phase sẽ hoàn thiện ở bước tiếp theo)');
        } catch (err) {
          await replyOrFollowUp(interaction, { content: `⚠️ ${err.message}`, flags: InteractionResponseFlags.Ephemeral });
        }
        return;
      }

      if (interaction.customId === 'sw_status') {
        if (!game) {
          await interaction.reply({ content: '⚠️ Không có phòng nào đang mở.', flags: InteractionResponseFlags.Ephemeral });
          return;
        }
        const alive = [...game.players.values()].filter((p) => p.isAlive).length;
        await interaction.reply({
          content: `📄 **Trạng thái:** ${game.status}\n🗓️ Ngày: ${game.dayNumber || 0} — Phase: ${game.phase || 'Chưa bắt đầu'}\n👥 Người chơi còn sống: ${alive}/${game.players.size}`,
          flags: InteractionResponseFlags.Ephemeral,
        });
        return;
      }

      if (interaction.customId === 'sw_cancel') {
        if (!game || game.hostId !== interaction.user.id) {
          await interaction.reply({ content: '⛔ Chỉ host mới được hủy phòng.', flags: InteractionResponseFlags.Ephemeral });
          return;
        }
        gameManager.cancelGame(interaction.guildId);
        await interaction.reply('🗑️ Phòng đã được hủy.');
        return;
      }
    }

    // 3. Select menu chon vai (host)
    if (interaction.isStringSelectMenu() && interaction.customId === 'sw_role_select') {
      try {
        gameManager.setSelectedRoles(interaction.guildId, interaction.user.id, interaction.values);
        await interaction.update({ content: `✅ Đã chọn: ${interaction.values.map((v) => ROLES[v].name).join(', ') || '(không có, dùng mặc định)'}`, components: [] });
        const game = gameManager.getGame(interaction.guildId);
        // Tim lai message goc cua lobby de refresh (interaction nay den tu ephemeral message rieng)
        const lobbyMsg = await interaction.channel.messages.fetch({ limit: 20 })
          .then((msgs) => msgs.find((m) => m.author.id === interaction.client.user.id && m.embeds[0]?.title?.includes('PHÒNG CHỜ')));
        if (lobbyMsg) {
          await lobbyMsg.edit({ embeds: [swCommand.buildLobbyEmbed(game)], components: swCommand.buildLobbyButtons() });
        }
      } catch (err) {
        await replyOrFollowUp(interaction, { content: `⚠️ ${err.message}`, flags: InteractionResponseFlags.Ephemeral });
      }
    }
  },
};
