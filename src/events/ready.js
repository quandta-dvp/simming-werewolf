module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client, { gameManager }) {
    console.log(`✅ ${client.user.tag} đã online — Simming Werewolf sẵn sàng.`);

    if (gameManager.store && gameManager.store.enabled) {
      try {
        const games = await gameManager.store.loadAll();
        for (const game of games) {
          gameManager.games.set(game.guildId, game);
          for (const userId of game.players.keys()) {
            gameManager.playerGuildMap.set(userId, game.guildId);
          }
        }
        if (games.length > 0) {
          console.log(`🔄 Đã khôi phục ${games.length} phòng Ma Sói đang chạy từ lần restart trước.`);
        }
      } catch (err) {
        console.error('[ready] Lỗi khôi phục game từ DB:', err.message);
      }
    }
  },
};
