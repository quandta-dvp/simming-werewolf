const { FACTION, ROLES } = require('./constants');

function getPlayerByRole(game, roleId) {
  for (const p of game.players.values()) {
    if (p.roleId === roleId && p.isAlive) return p;
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
  const wolves = aliveWolfCount(game);
  const others = aliveNonWolfCount(game);
  if (wolves === 0) return FACTION.VILLAGER;
  if (wolves >= others) return FACTION.WOLF;
  return null;
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

  const wolfKillBlockedByCave = !!(nullifiedPlayer && nullifiedPlayer.faction === FACTION.WOLF);
  const guardNullified = !!(guardHolder && nullifiedPlayer && guardHolder.userId === nullifiedPlayer.userId);
  const witchNullified = !!(witchHolder && nullifiedPlayer && witchHolder.userId === nullifiedPlayer.userId);
  const seerNullified = !!(seerHolder && nullifiedPlayer && seerHolder.userId === nullifiedPlayer.userId);
  const curseNullified = !!(soiNguyenHolder && nullifiedPlayer && soiNguyenHolder.userId === nullifiedPlayer.userId);

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

  // --- Sói Nguyền curse ---
  if (night.curseTarget && !curseNullified) {
    if (!game.cursedUserIds) game.cursedUserIds = new Set();
    game.cursedUserIds.add(night.curseTarget);
  }

  // --- Ap dung deaths ---
  const deathList = [];
  const hunterTriggerUserIds = [];
  for (const [userId, cause] of deaths.entries()) {
    const p = game.players.get(userId);
    if (!p || !p.isAlive) continue;
    p.isAlive = false;
    deathList.push({ userId, cause });
    log.push({ userId, text: cause === 'witch_poison' ? 'bị Phù Thủy đầu độc' : 'bị Sói cắn chết' });
    if (p.roleId === 'THO_SAN') hunterTriggerUserIds.push(userId);
    if (p.roleId === 'SOI_CON' && !game.wolfCubBonusUsed) {
      game.wolfCubBonusUsed = true;
      game.wolfCubBonusPending = true; // dem ke tiep se can 2
    }
  }

  // --- Seer ---
  const seerResults = [];
  if (night.seerTarget && !seerNullified) {
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
  } else if (night.seerTarget && seerNullified) {
    seerResults.push({ userId: night.seerTarget, noResult: true });
  }

  return {
    deaths: deathList,
    convertedBanSoi,
    seerResults,
    hunterTriggerUserIds,
    witchRawTargets: wolfRawTargets, // dung de bao phu thuy o dem ke tiep / hien tai
    log,
  };
}

function resolveDayVote(game) {
  const votes = game.dayVotes || new Map();
  const top = pickTopVoted(votes, 1);
  if (top.length === 0) return { lynchedUserId: null };
  // kiem tra hoa phieu -> khong treo ai
  const tally = new Map();
  for (const target of votes.values()) {
    if (!target) continue;
    tally.set(target, (tally.get(target) || 0) + 1);
  }
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
    return { lynchedUserId: null, tie: true };
  }
  const lynchedUserId = sorted[0][0];
  const player = game.players.get(lynchedUserId);
  player.isAlive = false;
  const result = { lynchedUserId, log: [{ userId: lynchedUserId, text: 'bị dân làng treo cổ' }] };
  if (player.roleId === 'THO_SAN') result.hunterTriggered = lynchedUserId;
  if (player.roleId === 'THANG_NGO') result.foolWins = true;
  if (player.roleId === 'SOI_CON' && !game.wolfCubBonusUsed) {
    game.wolfCubBonusUsed = true;
    game.wolfCubBonusPending = true;
  }
  return result;
}

module.exports = {
  getPlayerByRole,
  aliveWolfCount,
  aliveNonWolfCount,
  checkWinner,
  resolveNight,
  resolveDayVote,
  pickTopVoted,
};
