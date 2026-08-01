# Simming Werewolf 🐺

Discord bot hỗ trợ chơi Ma Sói (Werewolf) — 3 phe (Dân Làng / Ma Sói / Thứ 3), phase Đêm/Ngày, host tự chọn role, random role mỗi ván.

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
   - Bot Permissions: tick `Send Messages`, `Embed Links`, `Use Slash Commands`, `Manage Messages` (để edit lobby message), `Read Message History`, `Create Private Threads`, `Send Messages in Threads` (bắt buộc — bot dùng thread riêng cho từng vai trò: Tiên Tri, Bảo Vệ, Phù Thủy, Cave, Bầy Sói).
   - Copy URL ở cuối trang → mở URL này để mời (authorize) bot vào server test.

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


## 7. Roadmap tiếp theo

- [x] Random vai trò + nút "Xem Vai Trò Của Bạn" (ephemeral, host thấy full, người chơi chỉ thấy vai của mình)
- [x] Thread riêng theo từng vai trò có chức năng (Tiên Tri, Bảo Vệ, Phù Thủy, Cave, Bầy Sói) — Host được thêm vào tất cả để theo dõi, không thao tác được
- [x] Bầy Sói vote cắn chung trong 1 thread, thấy lựa chọn của nhau real-time (không còn DM riêng lẻ)
- [x] Bán Sói tự động được thêm vào thread Bầy Sói khi bị cắn trúng và chuyển phe
- [x] Bảng Điều Khiển công khai (bump được bởi bất kỳ ai) hiện: phase hiện tại, ai còn sống/đã chết, số lượng role
- [x] Host có nút Bỏ Qua Đêm/Ngày, Mở Vote (thay vì tự động mở), Kết Thúc Vote — cùng slash command dự phòng `/simwolf endnight` / `/simwolf endvote`
- [x] Vote ngày có thêm lựa chọn "Không treo ai"
- [x] Đóng (archive + lock) toàn bộ thread khi game kết thúc
- [x] Integration test mô phỏng toàn bộ 1 ván kèm thread/panel (`test/integration.test.js`)
- [x] Thợ Săn: đổi cơ chế thành chọn trước 1 mục tiêu mỗi đêm (có thread riêng như các role khác) — nếu Thợ Săn chết (đêm hoặc bị treo), mục tiêu đã chọn chết theo ngay lập tức (không còn chọn sau khi chết qua DM)
- [x] Ghi `game_logs` mỗi đêm, render bảng tổng kết dạng ảnh (puppeteer) khi kết thúc game
- [x] Sync game state xuống Postgres để sống sót qua restart (hiện toàn bộ state chỉ nằm trong RAM)
- [x] Kết nối `/simwolf stats` và `/simwolf leaderboard` với view `player_stats` trong Postgres

---

