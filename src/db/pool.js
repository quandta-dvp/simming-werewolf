const { Pool } = require('pg');
const config = require('../config');

/**
 * Pool dung chung cho toan bot. Neu chua cau hinh DATABASE_URL, pool = null
 * va moi noi goi store deu phai tu kiem tra (store se tro thanh no-op) -
 * de bot van chay binh thuong (chi mat tinh nang persist) khi chua co Postgres,
 * thay vi crash ngay luc start.
 */
let pool = null;

if (config.databaseUrl) {
  pool = new Pool({ connectionString: config.databaseUrl });
  pool.on('error', (err) => {
    // loi tren idle client khong duoc de crash ca process
    console.error('[db/pool] Lỗi Postgres pool (idle client):', err.message);
  });
} else {
  console.warn('[db/pool] Chưa cấu hình DATABASE_URL — bot sẽ chạy KHÔNG lưu state (mất tiến độ khi restart).');
}

module.exports = { pool };
