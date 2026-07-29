const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const config = require('./config');
const { GameManager } = require('./game/GameManager');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel], // can thiet de nhan DM
});

client.commands = new Collection();
const gameManager = new GameManager();

// --- Load commands ---
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command.data) client.commands.set(command.data.name, command);
}

// --- Load events ---
const eventsPath = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  const handler = (...args) => event.execute(...args, { commands: client.commands, gameManager });
  if (event.once) client.once(event.name, handler);
  else client.on(event.name, handler);
}

if (!config.token) {
  console.error('❌ Thiếu DISCORD_TOKEN trong .env — xem README phần cấu hình.');
  process.exit(1);
}

client.login(config.token);
