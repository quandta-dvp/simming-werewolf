# Simming Werewolf 🐺

Discord bot hỗ trợ chơi Ma Sói (Werewolf) — 3 phe (Dân Làng / Ma Sói / Thứ 3), phase Đêm/Ngày, host tự chọn role, random role mỗi ván, `/simwolf help` và `/simwolf leaderboard`.

> **Trạng thái hiện tại:** đây là bản scaffold ban đầu — bot đã connect được, có lobby (`/simwolf create` + tham gia/rời/chọn vai/bắt đầu), random role. Phần logic đêm/ngày chi tiết (night action, vote, tính thắng thua, log cuối ván) sẽ được bổ sung ở các bước tiếp theo.

---

## 1. Yêu cầu hệ thống

- Node.js >= 20
- Docker + Docker Compose (khuyến nghị để chạy trên server)
- 1 Discord Application + Bot Token (xem bước 2)

## 2. Tạo Discord Application

1. Vào https://discord.com/developers/applications → **New Application** → đặt tên `Simming Werewolf`.
2. Vào tab **Bot** → **Reset Token** → copy token này (dùng cho `DISCORD_TOKEN`).
3. Trong tab **Bot**, bật các **Privileged Gateway Intents** sau:
   - `SERVER MEMBERS INTENT` (không bắt buộc ở bản hiện tại, nhưng nên bật sẵn cho các bước sau)
   - Không cần `MESSAGE CONTENT INTENT` vì bot chỉ dùng slash command + button/select menu.
4. Vào tab **OAuth2 → General**, copy **Application ID** (dùng cho `DISCORD_CLIENT_ID`).
5. Vào tab **OAuth2 → URL Generator**:
   - Scopes: tick `bot` và `applications.commands`.
   - Bot Permissions: tick `Send Messages`, `Embed Links`, `Use Slash Commands`, `Manage Messages` (để edit lobby message), `Read Message History`.
   - Copy URL ở cuối trang → mở URL này để mời (authorize) bot vào server test của anh.

## 3. Cấu hình biến môi trường

```bash
cp .env.example .env
```

Điền vào `.env`:

```
DISCORD_TOKEN=<token từ bước 2.2>
DISCORD_CLIENT_ID=<application id từ bước 2.4>
DISCORD_GUILD_ID=<id server Discord dùng để test — chuột phải vào server > Copy Server ID (cần bật Developer Mode trong Discord)>
BOT_OWNER_ID=<Discord user ID của anh — dùng /simwolf reload>
DATABASE_URL=postgres://simwolf:simwolf@postgres:5432/simming_werewolf
```

> Lưu ý: điền `DISCORD_GUILD_ID` khi đang **test** — slash command sẽ được đăng ký riêng cho server đó và có hiệu lực **ngay lập tức**. Nếu để trống, command sẽ đăng ký global và Discord có thể mất tới 1 giờ để hiện ra.

## 4. Chạy bằng Docker (khuyến nghị cho quandta-lab)

```bash
docker compose up -d --build
```

Sau khi container `bot` chạy lên, đăng ký slash command (chỉ cần chạy lại khi thêm/đổi command):

```bash
docker compose exec bot npm run deploy-commands
```

Xem log:

```bash
docker compose logs -f bot
```

Khởi tạo schema Postgres (chạy 1 lần, dùng cho `/simwolf stats` và `/simwolf leaderboard` ở bước sau):

```bash
docker compose exec postgres psql -U simwolf -d simming_werewolf -f /dev/stdin < src/db/schema.sql
```

## 5. Chạy trực tiếp bằng Node (không dùng Docker — để dev nhanh)

```bash
npm install
npm run deploy-commands
npm start
```

## 6. Test trên Discord

1. Vào server đã authorize bot ở bước 2.5.
2. Gõ `/simwolf create` trong 1 kênh text → bot hiện lobby với các nút Tham Gia / Rời Phòng / Xem Vai Trò / Chọn Vai / Bắt Đầu Game / Trạng Thái / Hủy Phòng.
3. Đủ 6 người trở lên → host bấm **Bắt Đầu Game** để random role (phần gửi DM + xử lý đêm/ngày sẽ hoàn thiện ở bản tiếp theo).

## 7. Cấu trúc thư mục

```
src/
  index.js              # entry point, load command + event
  config.js              # đọc biến môi trường
  deploy-commands.js     # script đăng ký slash command lên Discord
  commands/
    simwolf.js            # /simwolf create|help|stats|leaderboard|reload
  events/
    ready.js
    interactionCreate.js  # xử lý slash command, button, select menu
  game/
    constants.js          # danh sách role, tỉ lệ Sói mặc định theo số người
    GameManager.js         # quản lý state lobby/game trong bộ nhớ
  db/
    schema.sql             # schema Postgres cho scoreboard
```

## 8. Roadmap tiếp theo

- [x] Gửi DM role riêng cho từng người khi start game
- [x] Night phase: select menu action theo từng role (Tiên Tri, Bảo Vệ, Phù Thủy, Cave, Sói, Sói Nguyền, Sói Con, Bán Sói, Thợ Săn, Thằng Ngố)
- [x] Day phase: công bố người chết (không lộ role) → vote treo cổ (tự chốt khi mọi người vote, hoặc host `/simwolf endnight` / `/simwolf endvote` để ép sớm)
- [x] Check điều kiện thắng sau mỗi lần có người chết
- [x] Integration test mô phỏng toàn bộ 1 ván (`test/integration.test.js`, chạy `node test/integration.test.js`)
- [ ] Bầy Sói hiện chỉ vote qua DM riêng từng người — chưa có "shared view" thấy lựa chọn của nhau (đơn giản hoá so với thiết kế ban đầu, cần làm thêm nếu muốn)
- [ ] Ghi `game_logs` mỗi đêm, render bảng tổng kết dạng ảnh (puppeteer) khi kết thúc game (hiện chỉ có embed liệt kê role, chưa có bảng log chi tiết từng đêm)
- [ ] Mở lại quyền chat cho người chết sau khi bảng tổng kết được post (hiện chưa có logic khoá/mở quyền kênh)
- [ ] Sync game state xuống Postgres để sống sót qua restart (hiện toàn bộ state chỉ nằm trong RAM)
- [ ] Kết nối `/simwolf stats` và `/simwolf leaderboard` với view `player_stats` trong Postgres

---

## 9. Đưa code lên GitHub repo riêng

Repo này hiện đang ở dạng file scaffold, chưa được push lên GitHub. Để tạo repo và đẩy code lên:

```bash
cd simming-werewolf
git init
git add .
git commit -m "chore: scaffold Simming Werewolf bot"
git branch -M main
git remote add origin https://github.com/<username>/simming-werewolf.git
git push -u origin main
```

(Tạo repo trống trên GitHub trước ở https://github.com/new, đặt tên `simming-werewolf`, **không** tick "Initialize with README" để tránh conflict khi push.)
