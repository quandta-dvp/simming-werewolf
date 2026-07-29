require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID || null,
  ownerId: process.env.BOT_OWNER_ID || null,
  databaseUrl: process.env.DATABASE_URL,
  botName: 'Simming Werewolf',
};
