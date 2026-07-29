const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  InteractionResponseFlags,
} = require('discord.js');
const { ROLES, MIN_PLAYERS, MAX_PLAYERS } = require('../game/GameManager');
const { FACTION } = require('../game/constants');
const config = require('../config');

const FACTION_LABEL = {
  [FACTION.WOLF]: '🔴 Phe Ma Sói',
  [FACTION.VILLAGER]: '🟢 Phe Dân Làng',
  [FACTION.THIRD_PARTY]: '⚪ Phe Thứ 3',
};

function buildLobbyEmbed(game, client) {
  const playerList = [...game.players.keys()]
    .map((id, i) => `${i + 1}. <@${id}>`)
    .join('\n') || '_Chưa có ai tham gia..._';

  const roleText = game.selectedRoles && game.selectedRoles.length
    ? game.selectedRoles.map((rid) => `${ROLES[rid].emoji} ${ROLES[rid].name}`).join(', ')
    : '_Host chưa chọn vai — sẽ dùng bộ mặc định_';

  return new EmbedBuilder()
    .setTitle('🐺 SIMMING WEREWOLF · PHÒNG CHỜ')
    .setColor(0x8b0000)
    .addFields(
      { name: 'Host', value: `<@${game.hostId}>`, inline: true },
      { name: 'Trạng thái', value: game.players.size >= MIN_PLAYERS ? '✅ Đủ điều kiện bắt đầu' : `Cần thêm ${MIN_PLAYERS - game.players.size} người`, inline: true },
      { name: `👥 Người chơi — ${game.players.size}/${MAX_PLAYERS}`, value: playerList },
      { name: '🃏 Vai trò đã chọn', value: roleText },
      { name: '\u200b', value: '🌙 Đêm — Mỗi phe hành động bí mật\n☀️ Ngày — Thảo luận & vote loại 1 người\n🏆 Thắng — Tiêu diệt toàn bộ đối phương\n⚠️ Tối thiểu 6 người · Tối đa 20 người' },
    )
    .setFooter({ text: `${config.botName} · Bấm nút bên dưới để tham gia!` })
    .setTimestamp();
}

function buildLobbyButtons() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sw_join').setLabel('Tham Gia').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('sw_leave').setLabel('Rời Phòng').setEmoji('❌').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('sw_view_roles').setLabel('Xem Vai Trò').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sw_select_roles').setLabel('Chọn Vai').setEmoji('🏹').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sw_start').setLabel('Bắt Đầu Game').setEmoji('▶️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('sw_status').setLabel('Trạng Thái').setEmoji('📄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sw_cancel').setLabel('Hủy Phòng').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
  return [row1, row2];
}

function buildRoleListEmbed() {
  const embed = new EmbedBuilder().setTitle('📋 Bảng Vai Trò Đầy Đủ').setColor(0x2b2d31);
  for (const factionKey of [FACTION.WOLF, FACTION.VILLAGER, FACTION.THIRD_PARTY]) {
    const roles = Object.values(ROLES).filter((r) => r.faction === factionKey);
    const text = roles.map((r) => `${r.emoji} **${r.name}** — ${r.description}`).join('\n');
    embed.addFields({ name: FACTION_LABEL[factionKey], value: text || '_(chưa có role)_' });
  }
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('simwolf')
    .setDescription('Simming Werewolf - bot hỗ trợ chơi Ma Sói')
    .addSubcommand((sub) => sub.setName('create').setDescription('Tạo phòng chờ Ma Sói mới trong kênh này'))
    .addSubcommand((sub) => sub.setName('help').setDescription('Xem hướng dẫn luật chơi, vai trò và các lệnh'))
    .addSubcommand((sub) => sub
      .setName('stats')
      .setDescription('Xem thống kê của bạn hoặc người khác')
      .addUserOption((opt) => opt.setName('user').setDescription('Người muốn xem thống kê').setRequired(false)))
    .addSubcommand((sub) => sub.setName('leaderboard').setDescription('Xem bảng xếp hạng Ma Sói của server'))
    .addSubcommand((sub) => sub.setName('reload').setDescription('[Owner] Tải lại toàn bộ slash command')),

  buildLobbyEmbed,
  buildLobbyButtons,
  buildRoleListEmbed,

  async execute(interaction, { gameManager }) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      try {
        const game = gameManager.createGame(interaction.guildId, interaction.channelId, interaction.user.id);
        await interaction.reply({
          embeds: [buildLobbyEmbed(game, interaction.client)],
          components: buildLobbyButtons(),
        });
      } catch (err) {
        await interaction.reply({ content: `⚠️ ${err.message}`, flags: InteractionResponseFlags.Ephemeral });
        .setDescription(
          '**Cách chơi cơ bản:**\n'
          + '1. `/simwolf create` để mở phòng chờ.\n'
          + '2. Mọi người bấm **Tham Gia** (tối thiểu 6, tối đa 20 người).\n'
          + '3. Host bấm **Chọn Vai** để tùy chỉnh role, hoặc để trống dùng bộ mặc định.\n'
          + '4. Host bấm **Bắt Đầu Game** — mỗi người nhận role qua tin nhắn riêng (DM).\n'
          + '5. Đêm: các role có hành động sẽ nhận select menu qua DM để thao tác.\n'
          + '6. Ngày: bot công bố ai chết đêm qua (không lộ role), thảo luận, rồi vote treo cổ.\n'
          + '7. Game kết thúc khi 1 phe thắng — bot công bố toàn bộ role + log cả ván.\n\n'
          + 'Dùng nút **Xem Vai Trò** trong phòng chờ để xem mô tả chi tiết từng role.',
        );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'stats') {
      const target = interaction.options.getUser('user') || interaction.user;
      await interaction.reply({
        content: `📊 Thống kê cho **${target.username}** — tính năng đang được hoàn thiện (cần kết nối Postgres, xem README phần Database).`,
      });
      return;
    }

    if (sub === 'leaderboard') {
      await interaction.reply({
        content: '🏆 Bảng xếp hạng — tính năng đang được hoàn thiện (cần kết nối Postgres, xem README phần Database).',
      });
      return;
    }

    if (sub === 'reload') {
      if (interaction.user.id !== config.ownerId) {
        await interaction.reply({ content: '⛔ Chỉ Owner bot mới dùng được lệnh này.', flags: InteractionResponseFlags.Ephemeral });
        return;
      }
      await interaction.reply({ content: '🔄 Đang tải lại slash command... chạy `npm run deploy-commands` trên server để đăng ký lại, bot sẽ tự nhận diện lệnh mới sau khi restart.' });
      return;
    }
  },
};
