const { ROLES, getDefaultRoleSet } = require('./constants');

const MIN_PLAYERS = 6;
const MAX_PLAYERS = 20;

/**
 * Luu 1 game theo tung guildId (moi guild chi 1 game tai 1 thoi diem).
 * Day la state trong bo nho cho ban scaffold - se sync xuong Postgres o buoc sau.
 */
class GameManager {
  constructor() {
    /** @type {Map<string, Game>} */
    this.games = new Map();
  }

  createGame(guildId, channelId, hostId) {
    if (this.games.has(guildId)) {
      throw new Error('Đã có 1 phòng Ma Sói đang mở trong server này.');
    }
    const game = {
      guildId,
      channelId,
      hostId,
      status: 'LOBBY', // LOBBY | RUNNING | ENDED
      players: new Map(), // userId -> { userId, roleId, isAlive }
      selectedRoles: null, // null = chua chon, se dung default set
      dayNumber: 0,
      phase: null, // NIGHT | DAY_ANNOUNCE | DAY_DISCUSS | DAY_VOTE
      createdAt: Date.now(),
    };
    this.games.set(guildId, game);
    return game;
  }

  getGame(guildId) {
    return this.games.get(guildId) || null;
  }

  cancelGame(guildId) {
    this.games.delete(guildId);
  }

  join(guildId, userId) {
    const game = this.getGame(guildId);
    if (!game) throw new Error('Chưa có phòng nào được tạo. Dùng /simwolf create trước.');
    if (game.status !== 'LOBBY') throw new Error('Phòng đã bắt đầu, không thể tham gia.');
    if (game.players.size >= MAX_PLAYERS) throw new Error(`Phòng đã đủ tối đa ${MAX_PLAYERS} người.`);
    if (game.players.has(userId)) throw new Error('Bạn đã ở trong phòng rồi.');
    game.players.set(userId, { userId, roleId: null, isAlive: true });
    return game;
  }

  leave(guildId, userId) {
    const game = this.getGame(guildId);
    if (!game) throw new Error('Không có phòng nào đang mở.');
    if (game.status !== 'LOBBY') throw new Error('Game đã bắt đầu, không thể rời phòng.');
    game.players.delete(userId);
    return game;
  }

  setSelectedRoles(guildId, hostId, roleIds) {
    const game = this.getGame(guildId);
    if (!game) throw new Error('Không có phòng nào đang mở.');
    if (game.hostId !== hostId) throw new Error('Chỉ host mới được chọn vai.');
    game.selectedRoles = roleIds;
    return game;
  }

  /**
   * Tinh danh sach role cuoi cung se dung khi start:
   * - Neu host da chon roleIds cu the -> fill Dan Thuong cho du so nguoi choi.
   * - Neu chua chon -> dung bo default theo constants.js
   */
  resolveFinalRoleList(game) {
    const playerCount = game.players.size;
    if (!game.selectedRoles || game.selectedRoles.length === 0) {
      return getDefaultRoleSet(playerCount);
    }
    const roles = [...game.selectedRoles];
    if (roles.length > playerCount) {
      throw new Error(`Số role đã chọn (${roles.length}) nhiều hơn số người chơi (${playerCount}).`);
    }
    const remaining = playerCount - roles.length;
    for (let i = 0; i < remaining; i++) roles.push('DAN_THUONG');
    return roles;
  }

  startGame(guildId, hostId) {
    const game = this.getGame(guildId);
    if (!game) throw new Error('Không có phòng nào đang mở.');
    if (game.hostId !== hostId) throw new Error('Chỉ host mới được bắt đầu game.');
    if (game.status !== 'LOBBY') throw new Error('Game đã bắt đầu rồi.');
    if (game.players.size < MIN_PLAYERS) {
      throw new Error(`Cần tối thiểu ${MIN_PLAYERS} người chơi (hiện có ${game.players.size}).`);
    }

    const roleList = this.resolveFinalRoleList(game);
    const shuffledRoles = shuffle(roleList);
    const playerIds = shuffle([...game.players.keys()]);

    playerIds.forEach((userId, idx) => {
      const player = game.players.get(userId);
      player.roleId = shuffledRoles[idx];
    });

    game.status = 'RUNNING';
    game.dayNumber = 1;
    game.phase = 'NIGHT';
    return game;
  }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { GameManager, MIN_PLAYERS, MAX_PLAYERS, ROLES };
