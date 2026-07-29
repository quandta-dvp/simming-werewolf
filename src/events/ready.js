module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`✅ ${client.user.tag} đã online — Simming Werewolf sẵn sàng.`);
  },
};
