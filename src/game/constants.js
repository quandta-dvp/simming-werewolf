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
  CUPID: {
    id: 'CUPID',
    name: 'Cupid',
    emoji: '💘',
    faction: FACTION.VILLAGER,
    hasNightAction: true,
    description: 'Chỉ đêm đầu tiên: chọn 2 người ghép thành 1 cặp đôi. Nếu 1 người trong cặp chết (bất kỳ cách nào), người còn lại chết theo ngay vì đau lòng. Nếu 2 người khác phe sống sót đến khi chỉ còn lại đúng 2 người, họ thắng riêng. Nếu bị Cave ngủ cùng đúng đêm đầu tiên, đêm đó không ghép được cặp nào.',
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

// Bo role mac dinh khi host khong bam "Chon Vai". Dam bao 2 dieu kien CUNG BAT BUOC:
// - Luon co DUNG playerCount role (khong duoc thua/thieu so voi so nguoi choi that su).
// - Luon co IT NHAT 1 Dan Thuong va 1 Soi Thuong (2 role mac dinh co ban buoc phai co) -
//   danh rieng 1 "slot" cho Dan Thuong truoc, cac vai dac biet (Tien Tri, Bao Ve, Phu Thuy,
//   Tho San, Cave) chi duoc them vao NEU con du cho, khong de chung lan het slot cua Dan Thuong.
function getDefaultRoleSet(playerCount) {
  const roles = [];

  // Vi luon phai danh rieng >=1 slot cho Dan Thuong, ngan so Soi lai neu can de khong vuot qua.
  const wolfBudget = Math.max(1, Math.min(getDefaultWolfCount(playerCount), playerCount - 1));

  let wolfSlots = wolfBudget;
  if (playerCount >= 14 && wolfSlots >= 2) {
    roles.push('SOI_CON');
    wolfSlots -= 1;
  }
  for (let i = 0; i < wolfSlots; i++) roles.push('SOI_THUONG');
  if (!roles.includes('SOI_THUONG')) roles.push('SOI_THUONG'); // dam bao luon co >=1 Soi Thuong "thuong", khong chi toan Soi dac biet

  const villagerCandidates = ['TIEN_TRI', 'BAO_VE'];
  if (playerCount >= 8) villagerCandidates.push('PHU_THUY');
  if (playerCount >= 11) villagerCandidates.push('THO_SAN');
  if (playerCount >= 14) villagerCandidates.push('CAVE');

  for (const roleId of villagerCandidates) {
    if (roles.length < playerCount - 1) roles.push(roleId); // luon chua lai it nhat 1 slot cho Dan Thuong
  }

  const remaining = playerCount - roles.length; // >= 1 luon dung nho reservation o tren
  for (let i = 0; i < remaining; i++) roles.push('DAN_THUONG');

  return roles;
}

module.exports = { FACTION, ROLES, getDefaultWolfCount, getDefaultRoleSet };
