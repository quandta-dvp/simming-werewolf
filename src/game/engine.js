const { FACTION, ROLES } = require('./constants');

function getPlayerByRole(game, roleId) {
  for (const p of game.players.values()) {
    if (p.roleId === roleId && p.isAlive) return p;
  }
  return null;
}

// Khong loc theo con song - dung khi can biet AI GIU role nay de gui thong tin/log,
// ke ca ho da chet trong chinh dem do (vd Tien Tri chet cung dem van phai nhan duoc ket qua soi).
function getPlayerByRoleAny(game, roleId) {
  for (const p of game.players.values()) {
    if (p.roleId === roleId) return p;
  }
  return null;
}

function aliveWolfCount(game) {
  return [...game.players.values()].filter((p) => p.isAlive && p.faction === FACTION.WOLF).length;
}

function aliveNonWolfCount(game) {
  return [...game.players.values()].filter((p) => p.isAlive && p.faction !== FACTION.WOLF).length;
}

function checkWinner(game) {
  // Cap doi Cupid khac phe, song sot toi khi chi con dung 2 nguoi -> thang rieng (giong Thang Ngo, mot nhanh phe 3)
  if (game.couple) {
    const [aId, bId] = game.couple;
    const a = game.players.get(aId);
    const b = game.players.get(bId);
    if (a && b && a.isAlive && b.isAlive && a.faction !== b.faction) {
      const aliveCount = [...game.players.values()].filter((p) => p.isAlive).length;
      if (aliveCount === 2) return 'LOVERS';
    }
  }

  const wolves = aliveWolfCount(game);
  const others = aliveNonWolfCount(game);
  if (wolves === 0) return FACTION.VILLAGER;
  if (wolves >= others) return FACTION.WOLF;
  return null;
}

// Xu ly cac cai chet "keo theo" dang queue (co the day chuyen nhieu vong):
// - Tho San chet -> muc tieu da chon truoc do chet theo ngay lap tuc.
// - 1 nguoi trong cap Cupid chet -> nguoi con lai chet theo vi qua dau long.
function applyDeathCascades(game, deathList, log) {
  const queue = [...deathList];
  while (queue.length) {
    const { userId } = queue.shift();
    const p = game.players.get(userId);
    if (!p) continue;

    if (p.roleId === 'THO_SAN') {
      const targetId = p.state.hunterTarget;
      const target = targetId ? game.players.get(targetId) : null;
      if (target && target.isAlive) {
        target.isAlive = false;
        const entry = { userId: targetId, cause: 'hunter_shot' };
        deathList.push(entry);
        queue.push(entry);
        log.push({ userId: targetId, text: `bị Thợ Săn (${game.displayNames?.get(userId) || userId}) bắn chết theo` });
      }
    }

    if (game.couple && game.couple.includes(userId)) {
      const partnerId = game.couple.find((id) => id !== userId);
      const partner = partnerId ? game.players.get(partnerId) : null;
      if (partner && partner.isAlive) {
        partner.isAlive = false;
        const entry = { userId: partnerId, cause: 'heartbreak' };
        deathList.push(entry);
        queue.push(entry);
        log.push({ userId: partnerId, text: 'quá đau lòng vì người yêu (do Cupid ghép) chết, chết theo ngay' });
      }
    }
  }
}

function pickTopVoted(voteMap, topN = 1) {
  // voteMap: Map(voterId -> targetId). Tra ve mang targetId co nhieu vote nhat (topN muc).
  const tally = new Map();
  for (const target of voteMap.values()) {
    if (!target) continue;
    tally.set(target, (tally.get(target) || 0) + 1);
  }
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return [];
  const results = [];
  let i = 0;
  while (results.length < topN && i < sorted.length) {
    results.push(sorted[i][0]);
    i++;
  }
  return results;
}

/**
 * Giai quyet 1 dem. `game.night` phai duoc dien day du truoc khi goi.
 * Tra ve { deaths: [{userId, cause}], seerResults: [{userId, text}], convertedBanSoi: [userId],
 *          witchInfo: {rawTargets:[]}, hunterTriggerUserIds: [userId], log: [{userId,text}] }
 */
function resolveNight(game) {
  const night = game.night;
  const log = [];
  const deaths = new Map(); // userId -> cause

  const caveTarget = night.caveTarget && night.caveTarget !== 'ALONE' ? night.caveTarget : null;
  const nullifiedPlayer = caveTarget ? game.players.get(caveTarget) : null;

  const guardHolder = getPlayerByRole(game, 'BAO_VE');
  const witchHolder = getPlayerByRole(game, 'PHU_THUY');
  const seerHolder = getPlayerByRole(game, 'TIEN_TRI');
  const soiNguyenHolder = getPlayerByRole(game, 'SOI_NGUYEN');
  const cupidHolder = getPlayerByRole(game, 'CUPID');

  const wolfKillBlockedByCave = !!(nullifiedPlayer && nullifiedPlayer.faction === FACTION.WOLF);
  const guardNullified = !!(guardHolder && nullifiedPlayer && guardHolder.userId === nullifiedPlayer.userId);
  const witchNullified = !!(witchHolder && nullifiedPlayer && witchHolder.userId === nullifiedPlayer.userId);
  const seerNullified = !!(seerHolder && nullifiedPlayer && seerHolder.userId === nullifiedPlayer.userId);
  const curseNullified = !!(soiNguyenHolder && nullifiedPlayer && soiNguyenHolder.userId === nullifiedPlayer.userId);
  const cupidNullified = !!(cupidHolder && nullifiedPlayer && cupidHolder.userId === nullifiedPlayer.userId);

  // --- Wolf kill(s) ---
  const bonusKills = game.wolfCubBonusPending ? 2 : 1;
  const wolfRawTargets = pickTopVoted(night.wolfVotes, bonusKills);
  const convertedBanSoi = [];

  if (!wolfKillBlockedByCave) {
    for (const targetId of wolfRawTargets) {
      if (guardHolder && !guardNullified && night.guardTarget === targetId) continue; // duoc bao ve
      const targetPlayer = game.players.get(targetId);
      if (!targetPlayer) continue;
      if (targetPlayer.roleId === 'BAN_SOI' && targetPlayer.faction !== FACTION.WOLF) {
        targetPlayer.faction = FACTION.WOLF; // chuyen phe, khong chet
        convertedBanSoi.push(targetId);
        log.push({ userId: targetId, text: 'bị Sói cắn nhưng không chết — lộ ra là Bán Sói, chuyển sang phe Sói' });
      } else {
        deaths.set(targetId, 'wolf_bite');
      }
    }
  }

  // --- Witch ---
  const witchAction = witchNullified ? null : night.witchAction;
  if (witchAction && witchAction.type === 'heal' && deaths.has(witchAction.targetId)) {
    deaths.delete(witchAction.targetId);
    log.push({ userId: witchAction.targetId, text: 'được Phù Thủy cứu sống' });
  }
  if (witchAction && witchAction.type === 'poison' && witchAction.targetId) {
    deaths.set(witchAction.targetId, 'witch_poison');
  }
  // Mat binh du bi Cave vo hieu hoa - dung night.witchAction GOC (truoc khi bi null hoa o tren),
  // va chi chot o day (khong chot ngay luc submit) de Phu Thuy con doi y trong cung 1 dem.
  if (night.witchAction && witchHolder) {
    if (night.witchAction.type === 'heal') witchHolder.state.healUsed = true;
    if (night.witchAction.type === 'poison') witchHolder.state.poisonUsed = true;
  }

  // --- Sói Nguyền curse ---
  if (night.curseTarget && !curseNullified) {
    if (!game.cursedUserIds) game.cursedUserIds = new Set();
    game.cursedUserIds.add(night.curseTarget);
  }

  // --- Cupid ghep cap (chi dem 1) ---
  if (night.cupidTargets && !game.couple) {
    if (cupidNullified) {
      log.push({ userId: cupidHolder.userId, text: 'bị Cave ngủ cùng đúng đêm nay nên không ghép được cặp nào' });
    } else {
      const [aId, bId] = night.cupidTargets;
      const a = game.players.get(aId);
      const b = game.players.get(bId);
      if (a && a.isAlive && b && b.isAlive) {
        game.couple = [aId, bId];
        log.push({ userId: aId, text: `được Cupid ghép cặp cùng ${game.displayNames?.get(bId) || bId}` });
        log.push({ userId: bId, text: `được Cupid ghép cặp cùng ${game.displayNames?.get(aId) || aId}` });
      }
    }
  }

  // --- Ap dung deaths (dot 1: tu Soi/Phu Thuy) ---
  const deathList = [];
  for (const [userId, cause] of deaths.entries()) {
    const p = game.players.get(userId);
    if (!p || !p.isAlive) continue;
    p.isAlive = false;
    deathList.push({ userId, cause });
    log.push({ userId, text: cause === 'witch_poison' ? 'bị Phù Thủy đầu độc' : 'bị Sói cắn chết' });
    if (p.roleId === 'SOI_CON' && !game.wolfCubBonusUsed) {
      game.wolfCubBonusUsed = true;
      game.wolfCubBonusPending = true; // dem ke tiep se can 2
    }
  }

  // --- Tho San / Cupid: xu ly cac cai chet keo theo (cascade) ---
  applyDeathCascades(game, deathList, log);

  // --- Seer ---
  const seerResults = [];
  if (night.seerTarget) {
    if (seerNullified) {
      // Bi Cave ngu cung -> luon tri ra la Dan (khong phai Soi), khong con "mat ket qua"
      seerResults.push({ userId: night.seerTarget, isWolf: false });
    } else {
      const target = game.players.get(night.seerTarget);
      let appearsWolf;
      if (target.roleId === 'BAN_SOI' && target.faction !== FACTION.WOLF) {
        appearsWolf = false;
      } else if (game.cursedUserIds && game.cursedUserIds.has(night.seerTarget)) {
        appearsWolf = true;
      } else {
        appearsWolf = target.faction === FACTION.WOLF || target.faction === FACTION.THIRD_PARTY;
      }
      seerResults.push({ userId: night.seerTarget, isWolf: appearsWolf });
    }
  }

  return {
    deaths: deathList,
    convertedBanSoi,
    seerResults,
    witchRawTargets: wolfRawTargets, // dung de bao phu thuy o dem ke tiep / hien tai
    log,
  };
}

function resolveDayVote(game) {
  const votes = game.dayVotes || new Map();
  const top = pickTopVoted(votes, 1);
  if (top.length === 0) return { lynchedUserId: null };
  const tally = new Map();
  for (const target of votes.values()) {
    if (!target) continue;
    tally.set(target, (tally.get(target) || 0) + 1);
  }
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  // hoa phieu giua top 1 va top 2 -> khong treo ai
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
    return { lynchedUserId: null, tie: true };
  }
  // phai dat qua ban (>50%) so nguoi CON SONG, khong chi la nhieu phieu nhat
  const aliveCount = [...game.players.values()].filter((p) => p.isAlive).length;
  const [topTargetId, topVoteCount] = sorted[0];
  if (topVoteCount <= aliveCount / 2) {
    return { lynchedUserId: null, notEnough: true };
  }
  const lynchedUserId = topTargetId;
  const player = game.players.get(lynchedUserId);
  player.isAlive = false;
  const log = [{ userId: lynchedUserId, text: 'bị dân làng treo cổ' }];
  const deathList = [{ userId: lynchedUserId, cause: 'lynched' }];
  const result = { lynchedUserId, log, deaths: deathList };
  if (player.roleId === 'THANG_NGO') result.foolWins = true;
  if (player.roleId === 'SOI_CON' && !game.wolfCubBonusUsed) {
    game.wolfCubBonusUsed = true;
    game.wolfCubBonusPending = true;
  }
  applyDeathCascades(game, deathList, log); // neu nguoi bi treo la Tho San hoac nam trong cap Cupid, keo theo cai chet
  result.extraDeaths = deathList.slice(1); // nhung nguoi chet an theo (Tho San keo theo)
  return result;
}

module.exports = {
  getPlayerByRole,
  getPlayerByRoleAny,
  aliveWolfCount,
  aliveNonWolfCount,
  checkWinner,
  resolveNight,
  resolveDayVote,
  pickTopVoted,
};
