const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const config = require('./config');
const { GameManager } = require('./game/GameManager');
const { GameStore } = require('./db/GameStore');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel], // can thiet de nhan DM
});

client.commands = new Collection();
const gameStore = new GameStore();
const gameManager = new GameManager(gameStore);

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

// --- Bảo vệ process khỏi bị crash vì lỗi Discord API / lỗi bất ngờ khác ---
// discord.js relay 1 số lỗi REST/gateway qua client.emit('error', ...); nếu không
// có listener, Node coi 'error' là event đặc biệt và sẽ throw + crash process.
client.on('error', (err) => {
  console.error('[Client Error]', err);
});

client.on('shardError', (err) => {
  console.error('[Shard Error]', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[Unhandled Rejection]', err);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});

client.login(config.token);
