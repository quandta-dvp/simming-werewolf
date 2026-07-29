const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data) commands.push(command.data.toJSON());
}

const rest = new REST().setToken(config.token);

(async () => {
  try {
    console.log(`⏳ Đang đăng ký ${commands.length} slash command...`);

    const route = config.guildId
      ? Routes.applicationGuildCommands(config.clientId, config.guildId)
      : Routes.applicationCommands(config.clientId);

    await rest.put(route, { body: commands });

    console.log(
      config.guildId
        ? `✅ Đã đăng ký command cho guild ${config.guildId} (có hiệu lực ngay).`
        : '✅ Đã đăng ký command global (Discord có thể mất tới 1 giờ để cập nhật).',
    );
  } catch (err) {
    console.error('❌ Lỗi khi đăng ký command:', err);
  }
})();
