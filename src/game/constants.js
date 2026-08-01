const FACTION = {
  VILLAGER: 'villager',
  WOLF: 'wolf',
  THIRD_PARTY: 'third_party',
};

// Bang role da chot. moi role co: id, ten hien thi, phe, co hanh dong dem hay khong,
// va co mac dinh (dung khi host khong bam "Chon Vai").
const ROLES = {
  DAN_THUONG: {
    id: 'DAN_THUONG',
    name: 'Dân Thường',
    emoji: '🧑‍🌾',
    faction: FACTION.VILLAGER,
    hasNightAction: false,
    description: 'Không có kỹ năng đặc biệt, sức mạnh là lá phiếu ban ngày.',
    isDefaultFiller: true, // dung de fill slot con lai
  },
  TIEN_TRI: {
    id: 'TIEN_TRI',
    name: 'Tiên Tri',
    emoji: '🔮',
    faction: FACTION.VILLAGER,
    hasNightAction: true,
    description: 'Mỗi đêm soi 1 người, biết họ có phải Sói hay không (kết quả gửi cuối đêm). Nếu bị Cave ngủ cùng, luôn tri ra "không phải Sói".',
    isDefaultCandidate: true,
  },
  BAO_VE: {
    id: 'BAO_VE',
    name: 'Bảo Vệ',
    emoji: '🛡️',
    faction: FACTION.VILLAGER,
    hasNightAction: true,
    description: 'Mỗi đêm chọn 1 người để bảo vệ khỏi bị Sói cắn. Không được bảo vệ trùng người 2 đêm liên tiếp.',
    isDefaultCandidate: true,
  },
  PHU_THUY: {
    id: 'PHU_THUY',
    name: 'Phù Thủy',
    emoji: '🧪',
    faction: FACTION.VILLAGER,
    hasNightAction: true,
    description: 'Luôn được báo có người chết mỗi đêm. Có 1 bình cứu + 1 bình độc, dùng 1 lần cả game. Mất bình dù action bị vô hiệu hóa (VD do Cave).',
    isDefaultCandidate: true,
  },
  THO_SAN: {
    id: 'THO_SAN',
    name: 'Thợ Săn',
    emoji: '🏹',
    faction: FACTION.VILLAGER,
    hasNightAction: true,
    description: 'Mỗi đêm chọn trước 1 người. Nếu Thợ Săn chết (do bất kỳ nguyên nhân gì, đêm hoặc bị treo), người được chọn cũng chết theo ngay lập tức.',
    isDefaultCandidate: true,
  },
  CAVE: {
    id: 'CAVE',
    name: 'Cave',
    emoji: '🕊️',
    faction: FACTION.VILLAGER,
    hasNightAction: true,
    description: 'Mỗi đêm chọn ngủ với 1 người hoặc ngủ 1 mình (không lặp người 2 đêm liên tiếp). Người bị ngủ cùng mất hiệu lực chức năng đêm đó (không biết lý do). Nếu ngủ với Sói, đêm đó Sói cắn không ai chết.',
    isDefaultCandidate: true,
  },
  SOI_THUONG: {
    id: 'SOI_THUONG',
    name: 'Sói Thường',
    emoji: '🐺',
    faction: FACTION.WOLF,
    hasNightAction: true,
    description: 'Cùng bầy Sói mỗi đêm bầu chọn 1 người để cắn.',
    isDefaultFiller: true,
  },
  SOI_NGUYEN: {
    id: 'SOI_NGUYEN',
    name: 'Sói Nguyền',
    emoji: '☠️',
    faction: FACTION.WOLF,
    hasNightAction: true,
    description: 'Ngoài vote cắn chung, chọn thêm 1 người để nguyền — người đó khi bị Tiên Tri soi sẽ luôn hiện ra là Sói.',
  },
  SOI_CON: {
    id: 'SOI_CON',
    name: 'Sói Con',
    emoji: '🐾',
    faction: FACTION.WOLF,
    hasNightAction: true,
    description: 'Vote cắn như Sói thường. Khi Sói Con chết (bất kỳ cách nào), đêm kế tiếp bầy Sói được cắn 2 người (kích hoạt 1 lần/game).',
  },
  BAN_SOI: {
    id: 'BAN_SOI',
    name: 'Bán Sói',
    emoji: '🐕',
    faction: FACTION.VILLAGER, // phe that ban dau la Dan, doi sang WOLF khi bi can trung
    hasNightAction: false,
    description: 'Là Dân 100% (kể cả khi bị Tiên Tri soi) cho tới khi bị Sói cắn trúng — khi đó không chết mà chuyển hẳn sang phe Sói.',
  },
  THANG_NGO: {
    id: 'THANG_NGO',
    name: 'Thằng Ngố',
    emoji: '🤡',
    faction: FACTION.THIRD_PARTY,
    hasNightAction: false,
    description: 'Thắng riêng nếu tự bị treo cổ vào ban ngày. Khi bị Tiên Tri soi sẽ hiện ra là Sói (mặc định phe 3).',
  },
};

// So Soi mac dinh theo tong so nguoi choi (bao gom Soi Nguyen/Soi Con neu duoc chon,
// KHONG bao gom Ban Soi - vi Ban Soi tinh la Dan cho toi khi bi can).
function getDefaultWolfCount(playerCount) {
  if (playerCount <= 7) return 2;
  if (playerCount <= 10) return 3;
  if (playerCount <= 13) return 3;
  if (playerCount <= 16) return 4;
  return 5; // 17-20
}

// Bo role mac dinh khi host khong bam "Chon Vai"
function getDefaultRoleSet(playerCount) {
  const wolfCount = getDefaultWolfCount(playerCount);
  const roles = [];

  let wolfSlots = wolfCount;
  if (playerCount >= 14) {
    roles.push('SOI_CON');
    wolfSlots -= 1;
  }
  for (let i = 0; i < wolfSlots; i++) roles.push('SOI_THUONG');

  const villagerSpecials = ['TIEN_TRI', 'BAO_VE'];
  if (playerCount >= 8) villagerSpecials.push('PHU_THUY');
  if (playerCount >= 11) villagerSpecials.push('THO_SAN');
  if (playerCount >= 14) villagerSpecials.push('CAVE');
  roles.push(...villagerSpecials);

  const filled = roles.length;
  const remaining = playerCount - filled;
  for (let i = 0; i < remaining; i++) roles.push('DAN_THUONG');

  return roles;
}

module.exports = { FACTION, ROLES, getDefaultWolfCount, getDefaultRoleSet };
