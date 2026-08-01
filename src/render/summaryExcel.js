const ExcelJS = require('exceljs');
const { ROLES, FACTION } = require('../game/constants');

const FACTION_FILL = {
  [FACTION.WOLF]: 'FFF4CCCC', // do nhat
  [FACTION.VILLAGER]: 'FFD9EAD3', // xanh la nhat
  [FACTION.THIRD_PARTY]: 'FFFFF2CC', // vang nhat
};

const HEADER_FILL = 'FF2B2D31';
const ALIVE_FILL = 'FFD9EAD3';
const DEAD_FILL = 'FFF4CCCC';

/**
 * Tao workbook Excel tong ket cuoi game: 1 hang / nguoi choi, 1 cot / ngay,
 * moi o ghi cac su kien xay ra voi nguoi do trong ngay/dem tuong ung
 * (tu game.gameLog: [{dayNumber, userId, roleId, text}]).
 *
 * Thay the ban render anh PNG (@napi-rs/canvas) da bi go bo vi gay loi
 * SIGILL (exit code 132) tren VPS do sai kien truc CPU / thieu instruction set.
 * exceljs la pure JS, khong co native binding, an toan tren moi kien truc.
 *
 * @param {object} game - object game (da ket thuc, con day du players/gameLog trong RAM)
 * @param {Map<string,string>} displayNames - userId -> ten hien thi (Discord)
 * @param {string} winnerLabel - vd "PHE MA SÓI", "PHE DÂN LÀNG", "THẰNG NGỐ"
 * @returns {Promise<Buffer>} buffer file .xlsx
 */
async function renderGameSummaryExcel(game, displayNames, winnerLabel) {
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

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Simming Werewolf';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Kết quả trận', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }], // giu cot Nguoi choi/Vai tro va hang header khi cuon
  });

  // ---- tieu de (dong 1, gop cot) ----
  const totalCols = 2 + dayCount; // Nguoi choi + Vai tro + N ngay
  sheet.mergeCells(1, 1, 1, totalCols);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `KẾT QUẢ TRẬN — ${winnerLabel} THẮNG!`;
  titleCell.font = { name: 'Arial', size: 14, bold: true };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 26;

  // ---- header (dong 2) ----
  const headerRow = sheet.getRow(2);
  headerRow.getCell(1).value = 'Người chơi';
  headerRow.getCell(2).value = 'Vai trò';
  for (const d of days) {
    headerRow.getCell(2 + d).value = `Ngày/Đêm ${d}`;
  }
  headerRow.eachCell((cell, colNumber) => {
    if (colNumber > totalCols) return;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = borderAll();
  });
  headerRow.height = 20;

  // ---- rows nguoi choi ----
  let rowIndex = 3;
  for (const p of players) {
    const row = sheet.getRow(rowIndex);
    const name = displayNames.get(p.userId) || p.userId;
    const roleInfo = ROLES[p.roleId] || { name: p.roleId, faction: null };

    const nameCell = row.getCell(1);
    nameCell.value = `${p.isAlive ? '🟢' : '💀'} ${name}`;
    nameCell.font = { name: 'Arial', size: 11, bold: true };
    nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: p.isAlive ? ALIVE_FILL : DEAD_FILL } };
    nameCell.alignment = { vertical: 'middle', horizontal: 'left' };
    nameCell.border = borderAll();

    const roleCell = row.getCell(2);
    roleCell.value = roleInfo.name;
    roleCell.font = { name: 'Arial', size: 11, bold: true };
    roleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FACTION_FILL[roleInfo.faction] || 'FFFFFFFF' } };
    roleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    roleCell.border = borderAll();

    for (const d of days) {
      const texts = logByCell.get(`${p.userId}_${d}`) || [];
      const cell = row.getCell(2 + d);
      cell.value = texts.length ? texts.join('\n') : '—';
      cell.font = { name: 'Arial', size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      cell.border = borderAll();
    }

    row.height = Math.max(20, 15 * Math.max(1, ...days.map((d) => (logByCell.get(`${p.userId}_${d}`) || ['']).length)));
    rowIndex++;
  }

  // ---- do rong cot ----
  sheet.getColumn(1).width = 26;
  sheet.getColumn(2).width = 18;
  for (const d of days) {
    sheet.getColumn(2 + d).width = 34;
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function borderAll() {
  const style = { style: 'thin', color: { argb: 'FFB7B7B7' } };
  return { top: style, left: style, bottom: style, right: style };
}

module.exports = { renderGameSummaryExcel };