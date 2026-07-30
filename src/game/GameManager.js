const { ROLES, getDefaultRoleSet, FACTION } = require('./constants');

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
    /** userId -> guildId, de tra cuu game tu tin nhan DM (DM khong co guildId) */
    this.playerGuildMap = new Map();
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
      players: new Map(), // userId -> { userId, roleId, faction, isAlive, state }
      selectedRoles: null, // null = chua chon, se dung default set
      dayNumber: 0,
      phase: null, // NIGHT | DAY_DISCUSS | DAY_VOTE
      night: null,
      dayVotes: null,
      cursedUserIds: new Set(),
      wolfCubBonusPending: false,
      wolfCubBonusUsed: false,
      threads: {}, // roleGroupKey -> threadId (TIEN_TRI, BAO_VE, PHU_THUY, CAVE, WOLVES)
      panelChannelId: null,
      panelMessageId: null,
      startedAt: null,
      createdAt: Date.now(),
    };
    this.games.set(guildId, game);
    return game;
  }

  getGame(guildId) {
    return this.games.get(guildId) || null;
  }

  getGameByPlayer(userId) {
    const guildId = this.playerGuildMap.get(userId);
    return guildId ? this.getGame(guildId) : null;
  }

  cancelGame(guildId) {
    const game = this.games.get(guildId);
    if (game) {
      for (const userId of game.players.keys()) this.playerGuildMap.delete(userId);
    }
    this.games.delete(guildId);
  }

  join(guildId, userId) {
    const game = this.getGame(guildId);
    if (!game) throw new Error('Chưa có phòng nào được tạo. Dùng /simwolf create trước.');
    if (game.status !== 'LOBBY') throw new Error('Phòng đã bắt đầu, không thể tham gia.');
    if (game.players.size >= MAX_PLAYERS) throw new Error(`Phòng đã đủ tối đa ${MAX_PLAYERS} người.`);
    if (game.players.has(userId)) throw new Error('Bạn đã ở trong phòng rồi.');
    game.players.set(userId, { userId, roleId: null, faction: null, isAlive: true, state: {} });
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
      player.faction = ROLES[shuffledRoles[idx]].faction;
      player.state = {};
      this.playerGuildMap.set(userId, guildId);
    });

    game.status = 'RUNNING';
    game.dayNumber = 1;
    game.startedAt = Date.now();
    game.phase = 'NIGHT';
    this.beginNightState(game);
    return game;
  }

  // ---------- Threads ----------

  static threadGroupOf(roleId) {
    if (roleId === 'SOI_THUONG' || roleId === 'SOI_NGUYEN' || roleId === 'SOI_CON') return 'WOLVES';
    if (roleId === 'TIEN_TRI' || roleId === 'BAO_VE' || roleId === 'PHU_THUY' || roleId === 'CAVE' || roleId === 'THO_SAN') return roleId;
    return null; // DAN_THUONG, THANG_NGO, BAN_SOI (chua can) - khong co thread rieng
  }

  // ---------- Night state ----------

  beginNightState(game) {
    game.phase = 'NIGHT';
    game.night = {
      wolfVotes: new Map(), // wolfUserId -> targetUserId
      curseTarget: null,
      guardTarget: undefined,
      caveTarget: undefined,
      witchAction: undefined,
      seerTarget: undefined,
      submittedUserIds: new Set(),
      dmMessages: new Map(), // userId -> {channel, message} de update tally cho bay Soi
    };
  }

  getAlivePlayers(game) {
    return [...game.players.values()].filter((p) => p.isAlive);
  }

  getNightActors(game) {
    return this.getAlivePlayers(game).filter((p) => ROLES[p.roleId].hasNightAction);
  }

  isNightComplete(game) {
    const actors = this.getNightActors(game);
    return actors.every((p) => game.night.submittedUserIds.has(p.userId));
  }

  submitWolfVote(game, userId, targetId) {
    const player = game.players.get(userId);
    if (!player || !player.isAlive || player.faction !== FACTION.WOLF) throw new Error('Bạn không phải Sói còn sống.');
    const targetPlayer = game.players.get(targetId);
    if (!targetPlayer || !targetPlayer.isAlive) throw new Error('Mục tiêu không hợp lệ.');
    if (targetPlayer.faction === FACTION.WOLF) throw new Error('Không thể cắn đồng đội Sói.');
    game.night.wolfVotes.set(userId, targetId);
    game.night.submittedUserIds.add(userId);
  }

  submitCurseTarget(game, userId, targetId) {
    game.night.curseTarget = targetId; // optional, khong bat buoc de hoan tat dem
  }

  submitGuardTarget(game, userId, targetId) {
    const player = game.players.get(userId);
    if (targetId !== 'SKIP' && player.state.lastGuardTarget === targetId) {
      throw new Error('Không được bảo vệ trùng người 2 đêm liên tiếp.');
    }
    game.night.guardTarget = targetId === 'SKIP' ? null : targetId;
    player.state.lastGuardTarget = game.night.guardTarget;
    game.night.submittedUserIds.add(userId);
  }

  submitCaveTarget(game, userId, targetId) {
    const player = game.players.get(userId);
    if (targetId !== 'ALONE' && player.state.lastCaveTarget === targetId) {
      throw new Error('Không được ngủ với cùng 1 người 2 đêm liên tiếp.');
    }
    game.night.caveTarget = targetId;
    player.state.lastCaveTarget = targetId;
    game.night.submittedUserIds.add(userId);
  }

  submitWitchAction(game, userId, action) {
    const player = game.players.get(userId);
    if (action.type === 'heal' && player.state.healUsed) throw new Error('Bạn đã dùng bình cứu rồi.');
    if (action.type === 'poison' && player.state.poisonUsed) throw new Error('Bạn đã dùng bình độc rồi.');
    if (action.type === 'heal') player.state.healUsed = true;
    if (action.type === 'poison') player.state.poisonUsed = true;
    game.night.witchAction = action;
    game.night.submittedUserIds.add(userId);
  }

  submitSeerTarget(game, userId, targetId) {
    game.night.seerTarget = targetId;
    game.night.submittedUserIds.add(userId);
  }

  submitHunterTarget(game, userId, targetId) {
    const player = game.players.get(userId);
    player.state.hunterTarget = targetId; // luon ghi de - dung lua chon gan nhat neu Tho San chet
    game.night.submittedUserIds.add(userId);
  }

  // ---------- Day vote ----------

  beginDayVote(game) {
    game.phase = 'DAY_VOTE';
    game.dayVotes = new Map();
  }

  submitDayVote(game, voterId, targetId) {
    const player = game.players.get(voterId);
    if (!player || !player.isAlive) throw new Error('Bạn không thể vote (đã chết hoặc không trong game).');
    game.dayVotes.set(voterId, targetId === 'NONE' ? null : targetId);
  }

  isDayVoteComplete(game) {
    const alive = this.getAlivePlayers(game);
    return alive.every((p) => game.dayVotes.has(p.userId));
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
