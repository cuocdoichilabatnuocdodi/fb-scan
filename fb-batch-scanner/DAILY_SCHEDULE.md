# Daily Schedule — Hướng dẫn cài đặt chạy hằng ngày

Chạy `node run.js` tự động mỗi ngày vào 1 giờ cố định (default 08:00).

---

## 📦 6 file (trong `scripts/schedule/`)

| OS | Cài schedule | Gỡ schedule | Chạy ngay (1 lần) |
|---|---|---|---|
| **macOS / Linux** | `install-schedule.command` | `uninstall-schedule.command` | `run-now.command` |
| **Windows** | `install-schedule.bat` | `uninstall-schedule.bat` | `run-now.bat` |

**Cách dùng: nhấp đúp vào file → script tự chạy → in trạng thái.**

- **install-schedule** → cài schedule chạy mỗi ngày
- **uninstall-schedule** → gỡ schedule
- **run-now** → chạy batch ngay lập tức (test schedule hoặc on-demand scan)

---

## ⏰ Đổi giờ chạy

Mặc định **08:00 sáng**. Để đổi, mở file install bằng text editor:

### macOS / Linux (`install-schedule.command`)
Tìm dòng:
```bash
SCHEDULE_HOUR=8
SCHEDULE_MIN=0
```
Đổi sang giờ mong muốn (24h format). Vd `SCHEDULE_HOUR=14 SCHEDULE_MIN=30` = 14:30.

### Windows (`install-schedule.bat`)
Tìm dòng:
```bat
set "SCHEDULE_TIME=08:00"
```
Đổi sang HH:MM (24h format). Vd `set "SCHEDULE_TIME=14:30"`.

**Sau khi đổi**: nhấp đúp lại install để áp dụng (script tự gỡ schedule cũ + cài mới).

---

## 🖥️ Cơ chế dưới capo

| OS | Cơ chế | Vị trí config |
|---|---|---|
| **macOS** | `launchd` | `~/Library/LaunchAgents/com.qing.fbscan.plist` |
| **Linux** | `cron` | `crontab -l` (user crontab) |
| **Windows** | Task Scheduler | Task name `QingFbScanDaily` |

Script tự detect OS bằng `uname -s` (mac/linux) hoặc chạy `.bat` (windows).

---

## ⚠️ Điều kiện máy chạy được

| Yêu cầu | Mô tả |
|---|---|
| **Máy bật** | Schedule chỉ fire khi máy đang chạy. Máy sleep / tắt → skip ngày đó |
| **User logged in** | Playwright cần GUI session (extension không chạy headless) |
| **Network** | FB.com phải reachable. Không cần tunnel (đã patch localhost) |
| **FB session còn hiệu lực** | `fb-session/` có cookie hợp lệ. Lần đầu cần login thủ công via `node run.js` |
| **Node.js cài sẵn** | Script find `node` trong PATH lúc install, hard-code path vào schedule |

### Tips chống Mac sleep lúc 8h sáng

```bash
# Option 1: tắt sleep khi cắm sạc
sudo pmset -c sleep 0

# Option 2: schedule Mac wake 7:55
# System Settings → Battery → Schedule (cần Intel Mac, M-series không có UI này nhưng vẫn dùng pmset được)
sudo pmset repeat wakeorpoweron MTWRFSU 07:55:00
```

### Windows: chạy ngay cả khi không login

Edit `install-schedule.bat` → thêm `/RU "SYSTEM" /RL HIGHEST` vào dòng `schtasks /Create` (cần Admin để cài lần đầu).

---

## 🧪 Test schedule không cần đợi

### macOS
```bash
launchctl start com.qing.fbscan
tail -f logs/launchd.out          # xem log realtime
```

### Linux
```bash
# cron không có "run now" — chạy command thẳng để test:
cd ~/path/to/fb-batch-scanner && node run.js
# Sau đó check logs/cron.out (sẽ có dữ liệu sau lần fire thật)
```

### Windows
```cmd
schtasks /Run /TN "QingFbScanDaily"
:: Xem log
type logs\sched.out
```

---

## 📊 Kiểm tra status

### macOS
```bash
launchctl list | grep com.qing.fbscan
# Output: PID? EXIT_CODE LABEL
#   "-"  0  com.qing.fbscan   ← idle (chưa chạy hôm nay hoặc đã xong)
#   "1234" 0 com.qing.fbscan  ← đang chạy
```

### Linux
```bash
crontab -l | grep fbscan
# Hiện entry cron nếu có
```

### Windows
```cmd
schtasks /Query /TN "QingFbScanDaily" /V /FO LIST
```

---

## 📄 Xem kết quả mỗi ngày

```bash
cd /path/to/fb-batch-scanner

# Report ngắn gọn của hôm nay
npm run report:today

# Toàn bộ history
npm run report

# Log raw (stderr/stdout của scheduler)
tail -50 logs/launchd.out    # macOS
tail -50 logs/cron.out       # Linux
type logs\sched.out          # Windows
```

---

## 🧹 Gỡ schedule

Nhấp đúp `uninstall-schedule.command` (mac/linux) hoặc `uninstall-schedule.bat` (windows). Script tự dọn launchd plist / cron entry / scheduled task.

Project + data + extension vẫn nguyên — chỉ gỡ phần auto-fire.

---

## 🔥 Common issues

### "node: command not found" trong launchd/cron log

`launchd`/`cron` có PATH tối thiểu, không thấy node nếu cài qua nvm. Fix:

**macOS** (`~/Library/LaunchAgents/com.qing.fbscan.plist`): script install đã hard-code path `node` lúc cài. Nếu sau đó update nvm version → re-run install để cập nhật path.

**Linux** (cron): tương tự, path node bị hard-code lúc install. Re-run install nếu đổi node version.

### Schedule fire nhưng không tạo file output

Kiểm tra:
1. `logs/launchd.err` (mac) / `logs/cron.err` (linux) / `logs\sched.err` (windows) → xem stderr
2. Mac/login: máy có wake không? → `pmset -g log | grep -i wake`
3. Permission: thư mục `logs/` writable?

### FB bắt re-login

Sau vài tuần, FB có thể invalidate session. Schedule sẽ chạy nhưng `node run.js` pause chờ user login (vì không có terminal interactive khi chạy schedule). Triệu chứng: log dừng ở "NOT LOGGED IN".

Fix: chạy `node run.js` thủ công 1 lần → login → exit → schedule lần sau OK.

---

## 📋 Tóm tắt quy trình hằng ngày (sau khi setup)

1. **8:00 AM** — schedule fire, Chromium mở, scan 50 group tự động
2. **~30-60 phút sau** — batch xong, Chromium tắt, exit code 0
3. **Bro check kết quả** — `npm run report:today` (hoặc mở folder `~/Downloads/Qing Cracked Posts Exporter for Facebook/`)
4. **Repeat tomorrow** — không cần làm gì
