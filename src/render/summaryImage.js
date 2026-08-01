const { createCanvas } = require('@napi-rs/canvas');
const { ROLES, FACTION } = require('../game/constants');

const FACTION_COLOR = {
  [FACTION.VILLAGER]: '#2e7d32', // xanh la
  [FACTION.WOLF]: '#c62828', // do
  [FACTION.THIRD_PARTY]: '#f9a825', // vang
};

const COLORS = {
  bg: '#1e1f22',
  headerBg: '#2b2d31',
  rowAltBg: '#26282c',
  border: '#3a3c41',
  textPrimary: '#f2f3f5',
  textMuted: '#949ba4',
  aliveDot: '#43b581',
  deadDot: '#ed4245',
};

/**
 * Render bang tong ket cuoi game: 1 hang / nguoi choi, 1 cot / ngay,
 * moi o ghi cac su kien xay ra voi nguoi do trong ngay/dem tuong ung
 * (tu game.gameLog: [{dayNumber, userId, roleId, text}]).
 *
 * @param {object} game - object game (da ket thuc, con day du players/gameLog trong RAM)
 * @param {Map<string,string>} displayNames - userId -> ten hien thi (Discord)
 * @param {string} winnerLabel - vd "PHE MA SÓI", "PHE DÂN LÀNG", "THẰNG NGỐ"
 * @returns {Buffer} PNG buffer
 */
function renderGameSummaryImage(game, displayNames, winnerLabel) {
  const players = [...game.players.values()];
  const dayCount = Math.max(game.dayNumber, 1);
  const days = Array.from({ length: dayCount }, (_, i) => i + 1);

  // gom log theo (userId, dayNumber) -> text[]
  const logByCell = new Map(); // key `${userId}_${dayNumber}` -> string[]
  for (const entry of game.gameLog || []) {
    const key = `${entry.userId}_${entry.dayNumber}`;
    if (!logByCell.has(key)) logByCell.set(key, []);
    logByCell.get(key).push(entry.text);
  }

  // ---- kich thuoc layout ----
  const nameColWidth = 220;
  const roleColWidth = 160;
  const dayColWidth = 200;
  const rowHeight = 64;
  const headerHeight = 90;
  const titleHeight = 60;
  const padding = 24;

  const width = padding * 2 + nameColWidth + roleColWidth + dayColWidth * dayCount;
  const height = padding * 2 + titleHeight + headerHeight + rowHeight * players.length;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // nen
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  // tieu de
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = 'bold 28px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(`KẾT QUẢ TRẬN — ${winnerLabel} THẮNG!`, padding, padding + titleHeight / 2);

  let y = padding + titleHeight;

  // header row
  ctx.fillStyle = COLORS.headerBg;
  ctx.fillRect(padding, y, width - padding * 2, headerHeight);
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = 'bold 16px sans-serif';
  let x = padding + 12;
  ctx.fillText('Người chơi', x, y + headerHeight / 2);
  x += nameColWidth;
  ctx.fillText('Vai trò', x, y + headerHeight / 2);
  x += roleColWidth;
  for (const d of days) {
    ctx.fillText(`Ngày/Đêm ${d}`, x + 12, y + headerHeight / 2);
    x += dayColWidth;
  }
  y += headerHeight;

  // rows
  ctx.font = '14px sans-serif';
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const rowY = y + i * rowHeight;

    if (i % 2 === 1) {
      ctx.fillStyle = COLORS.rowAltBg;
      ctx.fillRect(padding, rowY, width - padding * 2, rowHeight);
    }

    let cx = padding + 12;

    // trang thai song/chet + ten
    ctx.fillStyle = p.isAlive ? COLORS.aliveDot : COLORS.deadDot;
    ctx.beginPath();
    ctx.arc(cx + 5, rowY + rowHeight / 2, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLORS.textPrimary;
    ctx.font = 'bold 15px sans-serif';
    const name = displayNames.get(p.userId) || p.userId;
    ctx.fillText(truncate(name, 20), cx + 18, rowY + rowHeight / 2);
    cx += nameColWidth - 6;

    // vai tro (mau theo phe)
    const roleInfo = ROLES[p.roleId] || { name: p.roleId };
    ctx.fillStyle = FACTION_COLOR[p.faction] || COLORS.textMuted;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(truncate(roleInfo.name, 16), cx, rowY + rowHeight / 2);
    cx += roleColWidth;

    // tung ngay
    ctx.font = '13px sans-serif';
    for (const d of days) {
      const texts = logByCell.get(`${p.userId}_${d}`) || [];
      ctx.fillStyle = texts.length ? COLORS.textPrimary : COLORS.textMuted;
      const cellText = texts.length ? texts.join('; ') : '—';
      wrapText(ctx, truncate(cellText, 60), cx + 12, rowY + rowHeight / 2, dayColWidth - 24);
      cx += dayColWidth;
    }

    // duong ke ngang
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, rowY + rowHeight);
    ctx.lineTo(width - padding, rowY + rowHeight);
    ctx.stroke();
  }

  return canvas.toBuffer('image/png');
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

// wrap don gian toi da 2 dong, can giua theo chieu doc cua row
function wrapText(ctx, text, x, centerY, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const w of words) {
    const test = current ? current + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
    if (lines.length === 2) break; // toi da 2 dong
  }
  if (current && lines.length < 2) lines.push(current);

  const lineHeight = 16;
  const startY = centerY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, x, startY + i * lineHeight);
  });
}

module.exports = { renderGameSummaryImage };