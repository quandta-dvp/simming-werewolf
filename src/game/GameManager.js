const { ROLES, getDefaultRoleSet, FACTION } = require('./constants');

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 20;

/**
 * Luu 1 game theo tung guildId (moi guild chi 1 game tai 1 thoi diem).
 * Day la state trong bo nho cho ban scaffold - se sync xuong Postgres o buoc sau.
 */
class GameManager {
  /**
   * @param {import('../db/GameStore').GameStore} [store] - optional, neu khong
   * truyen vao thi GameManager van chay binh thuong tren RAM (khong persist).
   */
  constructor(store = null) {
    /** @type {Map<string, Game>} */
    this.games = new Map();
    /** userId -> guildId, de tra cuu game tu tin nhan DM (DM khong co guildId) */
    this.playerGuildMap = new Map();
    this.store = store;
  }

  /**
   * Fire-and-forget: khong await, khong de loi luu DB lam gian doan game dang choi.
   * Goi sau moi lan mutate state quan trong.
   */
  _persist(game) {
    if (this.store && game) this.store.save(game).catch(() => {}); // GameStore.save da tu catch, day la lop bao ve kep
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
      selectedDanCount: null, // null = chua chi dinh, tu dong fill Dan Thuong cho du so nguoi
      selectedSoiCount: null, // null = chua chi dinh so luong Soi Thuong cu the
      dayNumber: 0,
      phase: null, // NIGHT | DAY_DISCUSS | DAY_VOTE
      night: null,
      dayVotes: null,
      cursedUserIds: new Set(),
      couple: null, // [userIdA, userIdB] do Cupid ghep dem 1, hoac null neu chua/khong ghep
      wolfCubBonusPending: false,
      wolfCubBonusUsed: false,
      threads: {}, // roleGroupKey -> threadId (TIEN_TRI, BAO_VE, PHU_THUY, CAVE, WOLVES)
      panelChannelId: null,
      panelMessageId: null,
      startedAt: null,
      createdAt: Date.now(),
      gameLog: [], // [{ dayNumber, userId, roleId, text }] - tich luy moi dem/ngay, dung cho bang tong ket cuoi game
    };
    this.games.set(guildId, game);
    this._persist(game);
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
    if (this.store) this.store.delete(guildId).catch(() => {});
  }

  join(guildId, userId) {
    const game = this.getGame(guildId);
    if (!game) throw new Error('Chưa có phòng nào được tạo. Dùng /simwolf create trước.');
    if (game.status !== 'LOBBY') throw new Error('Phòng đã bắt đầu, không thể tham gia.');
    if (game.players.size >= MAX_PLAYERS) throw new Error(`Phòng đã đủ tối đa ${MAX_PLAYERS} người.`);
    if (game.players.has(userId)) throw new Error('Bạn đã ở trong phòng rồi.');
    game.players.set(userId, { userId, roleId: null, faction: null, isAlive: true, state: {} });
    this._persist(game);
    return game;
  }

  leave(guildId, userId) {
    const game = this.getGame(guildId);
    if (!game) throw new Error('Không có phòng nào đang mở.');
    if (game.status !== 'LOBBY') throw new Error('Game đã bắt đầu, không thể rời phòng.');
    game.players.delete(userId);
    this._persist(game);
    return game;
  }

  setSelectedRoles(guildId, hostId, roleIds) {
    const game = this.getGame(guildId);
    if (!game) throw new Error('Không có phòng nào đang mở.');
    if (game.hostId !== hostId) throw new Error('Chỉ host mới được chọn vai.');
    game.selectedRoles = roleIds;
    this._persist(game);
    return game;
  }

  setDanSoiCounts(guildId, hostId, danCount, soiCount) {
    const game = this.getGame(guildId);
    if (!game) throw new Error('Không có phòng nào đang mở.');
    if (game.hostId !== hostId) throw new Error('Chỉ host mới được chọn vai.');
    if (danCount != null && (!Number.isInteger(danCount) || danCount < 0)) {
      throw new Error('Số Dân Thường phải là số nguyên ≥ 0.');
    }
    if (soiCount != null && (!Number.isInteger(soiCount) || soiCount < 0)) {
      throw new Error('Số Sói Thường phải là số nguyên ≥ 0.');
    }
    game.selectedDanCount = danCount;
    game.selectedSoiCount = soiCount;
    this._persist(game);
    return game;
  }

  /**
   * Tinh danh sach role cuoi cung se dung khi start:
   * - Neu host chua chon gi ca (khong role dac biet, khong so luong Dan/Soi) -> dung bo default.
   * - Neu host da chi dinh so luong Dan Thuong va/hoac Soi Thuong cu the -> tong so
   *   (vai dac biet + Dan + Soi) BAT BUOC khop dung so nguoi choi, khong tu dong fill them.
   * - Neu host chi chon vai dac biet (chua chi dinh so luong Dan/Soi) -> giu hanh vi cu:
   *   fill het phan con lai bang Dan Thuong.
   */
  resolveFinalRoleList(game) {
    const playerCount = game.players.size;
    const hasCustomCounts = game.selectedDanCount != null || game.selectedSoiCount != null;

    if ((!game.selectedRoles || game.selectedRoles.length === 0) && !hasCustomCounts) {
      return getDefaultRoleSet(playerCount);
    }

    const specialRoles = [...(game.selectedRoles || [])];

    if (hasCustomCounts) {
      const danCount = game.selectedDanCount ?? 0;
      const soiCount = game.selectedSoiCount ?? 0;
      const roles = [...specialRoles];
      for (let i = 0; i < soiCount; i++) roles.push('SOI_THUONG');
      for (let i = 0; i < danCount; i++) roles.push('DAN_THUONG');
      if (roles.length !== playerCount) {
        throw new Error(
          `Tổng số role (${specialRoles.length} vai đặc biệt + ${danCount} Dân Thường + ${soiCount} Sói Thường = ${roles.length}) `
          + `phải khớp ĐÚNG số người chơi hiện tại (${playerCount}). Hãy điều chỉnh lại số Dân/Sói hoặc danh sách vai đặc biệt.`,
        );
      }
      return roles;
    }

    const roles = [...specialRoles];
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
    this._persist(game);
    return game;
  }

  // ---------- Threads ----------

  static threadGroupOf(roleId, faction) {
    if (faction === FACTION.WOLF) return 'WOLVES'; // gom ca Ban Soi da hoa Soi (roleId van la BAN_SOI nhung faction doi sang wolf)
    if (roleId === 'TIEN_TRI' || roleId === 'BAO_VE' || roleId === 'PHU_THUY' || roleId === 'CAVE' || roleId === 'THO_SAN' || roleId === 'CUPID') return roleId;
    return null; // DAN_THUONG, THANG_NGO, BAN_SOI (chua bi can) - khong co thread rieng
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
      cupidTargets: undefined,
      submittedUserIds: new Set(),
      promptMessages: [], // [{channelId, messageId}] - tat ca menu da gui dem nay, de vo hieu hoa khi dem ket thuc
    };
    this._persist(game);
  }

  getAlivePlayers(game) {
    return [...game.players.values()].filter((p) => p.isAlive);
  }

  getNightActors(game) {
    return this.getAlivePlayers(game).filter((p) => {
      if (p.faction === FACTION.WOLF) return true; // ca Ban Soi da hoa Soi cung phai duoc tinh la actor de vote can dem
      if (!ROLES[p.roleId].hasNightAction) return false;
      if (p.roleId === 'CUPID') return game.dayNumber === 1; // Cupid chi hanh dong dem dau tien
      return true;
    });
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
    this._persist(game);
  }

  submitCurseTarget(game, userId, targetId) {
    game.night.curseTarget = targetId; // optional, khong bat buoc de hoan tat dem
    this._persist(game);
  }

  submitGuardTarget(game, userId, targetId) {
    const player = game.players.get(userId);
    if (targetId !== 'SKIP' && player.state.lastGuardTarget === targetId) {
      throw new Error('Không được bảo vệ trùng người 2 đêm liên tiếp.');
    }
    game.night.guardTarget = targetId === 'SKIP' ? null : targetId;
    player.state.lastGuardTarget = game.night.guardTarget;
    game.night.submittedUserIds.add(userId);
    this._persist(game);
  }

  submitCaveTarget(game, userId, targetId) {
    const player = game.players.get(userId);
    if (targetId !== 'ALONE' && player.state.lastCaveTarget === targetId) {
      throw new Error('Không được ngủ với cùng 1 người 2 đêm liên tiếp.');
    }
    game.night.caveTarget = targetId;
    player.state.lastCaveTarget = targetId;
    game.night.submittedUserIds.add(userId);
    this._persist(game);
  }

  // Luu y: KHONG danh dau healUsed/poisonUsed o day - de nguoi choi con doi y (vd chon
  // poison roi doi sang heal) trong cung 1 dem ma khong bi mat oan 1 binh. Co "*Used"
  // chi thuc su duoc chot trong engine.resolveNight, dua tren lua chon CUOI CUNG dem do.
  submitWitchAction(game, userId, action) {
    const player = game.players.get(userId);
    if (action.type === 'heal' && player.state.healUsed) throw new Error('Bạn đã dùng bình cứu rồi.');
    if (action.type === 'poison' && player.state.poisonUsed) throw new Error('Bạn đã dùng bình độc rồi.');
    game.night.witchAction = action;
    game.night.submittedUserIds.add(userId);
    this._persist(game);
  }

  submitSeerTarget(game, userId, targetId) {
    game.night.seerTarget = targetId;
    game.night.submittedUserIds.add(userId);
    this._persist(game);
  }

  submitCupidTargets(game, userId, targetIds) {
    if (!Array.isArray(targetIds) || targetIds.length !== 2) {
      throw new Error('Cupid phải chọn đúng 2 người để ghép cặp.');
    }
    if (targetIds[0] === targetIds[1]) {
      throw new Error('Không thể ghép 1 người với chính họ.');
    }
    game.night.cupidTargets = targetIds;
    game.night.submittedUserIds.add(userId);
    this._persist(game);
  }

  submitHunterTarget(game, userId, targetId) {
    const player = game.players.get(userId);
    player.state.hunterTarget = targetId; // luon ghi de - dung lua chon gan nhat neu Tho San chet
    game.night.submittedUserIds.add(userId);
    this._persist(game);
  }

  // ---------- Day vote ----------

  beginDayVote(game) {
    game.phase = 'DAY_VOTE';
    game.dayVotes = new Map();
    this._persist(game);
  }

  submitDayVote(game, voterId, targetId) {
    const player = game.players.get(voterId);
    if (!player || !player.isAlive) throw new Error('Bạn không thể vote (đã chết hoặc không trong game).');
    game.dayVotes.set(voterId, targetId === 'NONE' ? null : targetId);
    this._persist(game);
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
