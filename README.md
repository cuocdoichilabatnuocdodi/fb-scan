# qing-fb-scan

Batch scan nhiều Facebook group tự động, lưu posts + attachments về disk theo cấu trúc rõ ràng.

## 🧭 Tổng quan

Hệ thống gồm 3 thành phần:

```
qing-fb-scan/
├── extension/                          ← Chrome extension đã patch (Qing Cracked Posts Exporter)
├── fb-batch-scanner/                   ← Playwright orchestrator (Node.js)
└── posts-exporter-for-facebook/        ← Output data (auto-created)
```

**Flow:**
```
node run.js
   ↓
spawn Chromium → load extension → attach via CDP
   ↓
loop từng group URL trong config/groups.txt:
   ├─ navigate FB group
   ├─ click "Download These Posts"
   ├─ apply filter (days / posts count)
   ├─ click Start → extension scan
   ├─ webhook báo "export.completed"
   └─ relocate files vào posts-exporter-for-facebook/<groupId>#<groupName>/<postId>#<timestamp>/
   ↓
Exit khi xong, Chromium đóng graceful
```

---

## 🚀 Quick Start

```bash
# 1. Cài deps (lần đầu)
cd qing-fb-scan/fb-batch-scanner
npm install
npx playwright install chromium

# 2. Login FB (lần đầu — sẽ pause script chờ bạn login)
node run.js
# → mở Chromium → login facebook → ENTER ở terminal → batch tiếp tục

# 3. Lần sau chỉ cần:
node run.js
# Hoặc double-click: scripts/schedule/run-now.command
```

---

## ⚠️ Configuration — MUST HAVE (bắt buộc setup)

### 1. Login Facebook (1 lần / vài tuần)

- **Cách**: chạy `node run.js` lần đầu → Chromium mở → login bằng tay → ENTER ở terminal
- **Persist**: cookie lưu vào `fb-batch-scanner/fb-session/` → tự dùng lại các lần sau
- **Khi nào cần login lại**: FB invalidate session (~vài tuần) → script tự pause chờ login → ENTER tiếp tục

### 2. Danh sách groups

File: `fb-batch-scanner/config/groups.txt`
```
# 1 URL / dòng, comment bằng #
https://www.facebook.com/groups/VietnamGamingConner
https://www.facebook.com/groups/760589759199370/
```

### 3. Node.js + Playwright

- Node >= 18 (test với v22)
- `npm install` + `npx playwright install chromium` (lần đầu, ~170MB Chromium download)
- `run-now.command` / `install-schedule.command` tự bootstrap nếu thiếu

---

## 🎛️ Configuration — NICE TO HAVE (tùy chỉnh)

### Filter (`fb-batch-scanner/config/filter.json`)

```json
{
  "fetchQuantity": {
    "mode": "BY_DAYS_COUNT",         // FETCH_ALL | BY_POST_COUNT | BY_DAYS_COUNT
    "days": 1,                       // dùng khi mode = BY_DAYS_COUNT
    "_postsCount": 50                // dùng khi mode = BY_POST_COUNT (rename _postsCount → postsCount để active)
  },
  "options": {
    "includeComments": false,        // tải comments
    "includeAttachments": true,      // tải ảnh/video
    "saveAsJSON": true,              // ghi post.json
    "generateHTML": false,           // ghi post.html (heavy)
    "translateContent": false        // dịch nội dung
  },
  "advanced": {
    "requestDelaySeconds": 1         // delay giữa FB GraphQL request (chống flag)
  }
}
```

Field `_underscored` = bị validator skip. Để active, rename bỏ `_`. Validator chạy fail-fast với hint khi config sai.

### Environment (`fb-batch-scanner/.env`)

```bash
PORT=3000                                       # webhook server port (local)
WEBHOOK_SECRET=<random-32-char>                 # bảo vệ webhook
EXTENSION_PATH=../extension                     # path extension (relative/absolute/~)
FB_SESSION_DIR=./fb-session                     # FB cookies persistence

DOWNLOAD_ROOT=..                                # parent dir cho output
OUTPUT_FOLDER_NAME=posts-exporter-for-facebook  # subfolder bên trong DOWNLOAD_ROOT

GROUP_DELAY_MS=8000                             # delay giữa groups (chống FB rate-limit)
GROUP_TIMEOUT_MS=600000                         # max 10 phút/group, sau đó skip
PAGE_LOAD_WAIT_MS=8000                          # đợi FB load page

HEADLESS=false                                  # extension cần headless=false
DEBUG=true                                      # verbose log
```

### Schedule chạy hằng ngày

Folder `fb-batch-scanner/scripts/schedule/` có sẵn 6 file:

| File | Hành động |
|---|---|
| `install-schedule.command` | macOS/Linux: cài cron/launchd chạy 8h sáng mỗi ngày |
| `uninstall-schedule.command` | macOS/Linux: gỡ schedule |
| `run-now.command` | macOS/Linux: chạy ngay 1 lần (auto-bootstrap deps) |
| `install-schedule.bat` | Windows: cài Task Scheduler |
| `uninstall-schedule.bat` | Windows: gỡ |
| `run-now.bat` | Windows: chạy ngay |

→ Nhấp đúp để chạy. Đổi giờ chạy: sửa biến `SCHEDULE_HOUR` / `SCHEDULE_TIME` ở đầu file install.

Chi tiết: `fb-batch-scanner/DAILY_SCHEDULE.md`

---

## 📂 Output structure

```
posts-exporter-for-facebook/
└── <groupId>#<groupName>/                              ← vd: 760589759199370#GearVN - Chợ PC
    └── <postId>#<YYYY_MM_DD__HH_MM_SS>/                ← vd: 2862921457407236#2026_05_18__09_30_15
        ├── post.json                                   ← (nếu saveAsJSON)
        ├── post.html                                   ← (nếu generateHTML)
        ├── comments.json + comments.csv                ← (nếu includeComments)
        └── attachments/
            ├── <original_filename>.jpg
            └── <original_filename>.mp4
```

**Folder naming:**
- `<groupId>` = FB group ID dạng số (auto-extract từ URL hoặc webhook event)
- `<postId>` = FB post ID (đọc từ field `post_id` trong post.json)
- `<groupName>` = group title từ FB page (sanitized)
- `<timestamp>` = thời điểm scan, format `YYYY_MM_DD__HH_MM_SS`

---

## 📊 Reports + Logs

```bash
cd fb-batch-scanner

# Báo cáo hôm nay
npm run report:today

# All-time
npm run report

# Filter theo runId / date
node scripts/report.js --date 2026-05-18
node scripts/report.js --run <runId>
node scripts/report.js --json | jq

# Log raw (JSON Lines, dùng jq)
cat logs/2026-05-18.jsonl | jq 'select(.level=="error")'
cat runs.jsonl | jq 'select(.status=="completed") | .posts' | awk '{s+=$1}END{print s}'
```

Schema 1 entry trong `runs.jsonl`:
```json
{
  "runId": "<UUID batch>",
  "groupId": "<UUID per scan>",
  "ts": "2026-05-18T11:23:45Z",
  "url": "https://www.facebook.com/groups/...",
  "name": "Group Name",
  "collectionId": "<FB collectionId>",
  "status": "completed | failed | stopped | skipped",
  "posts": 8,
  "durationSec": 83.7,
  "error": null
}
```

---

## 🧹 Reset / Cleanup

```bash
cd fb-batch-scanner

npm run reset-session    # xóa fb-session/ → cần login lại lần sau
npm run reset-state      # xóa state.json (progress tracker)

# Xóa toàn bộ data đã scrape:
rm -rf ../posts-exporter-for-facebook/*
```

---

## 🔧 Troubleshooting

### "NOT LOGGED IN" mỗi lần chạy
- Lý do: FB invalidate session, hoặc lần trước Chromium bị kill cứng (SIGKILL)
- Fix: chạy `node run.js` 1 lần, login lại bằng tay, ENTER, để batch chạy xong tự nhiên (đừng Cmd+Q)

### Files không xuất hiện trong output folder
- Check log có `relocate: moved=N` (N > 0)
- Check `runs.jsonl` xem status có "completed" không
- Check extension config webhook đã set chưa (script tự sync mỗi lần launch, nhưng có thể fail)

### "scan modal did not appear after clicking trigger"
- FB UI có overlay đè button → script đã dùng JS `el.click()` bypass
- Nếu vẫn fail: tăng `PAGE_LOAD_WAIT_MS` lên 12000-15000

### Validator báo lỗi `_postsCount` underscored
- Rename `_postsCount` → `postsCount` trong filter.json khi muốn dùng `BY_POST_COUNT` mode
- Tương tự `_days` → `days` cho `BY_DAYS_COUNT`

### Chromium "didn't shut down correctly" prompt
- Lần chạy trước bị SIGKILL → profile chưa flush
- Script đã cải thiện (SIGTERM + wait 5s → SIGKILL nếu treo), không nên xảy ra nữa
- Nếu vẫn xảy ra: kill bằng tay đúng cách (Cmd+W close window, KHÔNG Cmd+Q)

### Batch xong nhưng không qua group tiếp
- Webhook không tới được. Check `fb-session/` có chứa webhookConfig đúng (script tự sync)
- Inspect: `chrome-extension://<ID>/src/pages/options/index.html#/webhook/logs`

---

## 🛠️ Architecture nội bộ

**Key files trong `fb-batch-scanner/`:**

| File | Vai trò |
|---|---|
| `run.js` | Entry point, orchestrator chính |
| `lib/browser.js` | Spawn Chromium + connect CDP + cleanup graceful |
| `lib/group-runner.js` | Logic scan 1 group: navigate → click → filter → wait webhook |
| `lib/webhook-server.js` | HTTP server :3000 nhận event từ extension |
| `lib/setup-webhook.js` | Push webhookConfig vào extension storage mỗi launch |
| `lib/apply-folder-name.js` | Patch extension brand constant (cho OUTPUT_FOLDER_NAME) |
| `lib/download-relocator.js` | Hook chrome.downloads + relocate temp UUIDs → proper paths |
| `lib/validate-filter.js` | Fail-fast validator cho filter.json |
| `lib/state.js` | Track done/failed/skipped |
| `lib/runs-log.js` | Append runs.jsonl |
| `lib/logger.js` | JSONL log + colored console |
| `scripts/report.js` | Read runs.jsonl → table report |
| `scripts/schedule/*` | Install/uninstall/run-now scripts |

**Extension patches (đã apply, có `.bak` backup):**

| File | Sửa gì |
|---|---|
| `manifest.json` | Thêm `http://localhost:3000/*` host permission |
| `assets/background-Dl8yhJ0h.js` | Bypass webhook URL validator (cho localhost http) |
| `injects/index.js` | UI: Custom days input, posts InputNumber, date range label; folder brand → `OUTPUT_FOLDER_NAME` |

→ Nếu extension update, các patch sẽ mất → cần re-apply.

---

## 📝 Daily workflow tóm tắt

```bash
# Lần đầu setup:
cd fb-batch-scanner
npm install && npx playwright install chromium
node run.js                # login FB lần đầu
# → ENTER khi đã login → batch chạy → tự exit

# Hằng ngày (manual):
node run.js                # hoặc double-click run-now.command

# Hằng ngày (auto):
# Nhấp đúp scripts/schedule/install-schedule.command (1 lần) → mỗi 8h sáng tự chạy

# Check kết quả:
npm run report:today
open ../posts-exporter-for-facebook/
```
