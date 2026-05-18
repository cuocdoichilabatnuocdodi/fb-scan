# fb-batch-scanner

Batch scan nhiều Facebook group dùng extension **Qing Cracked Posts Exporter** + Playwright.

## Cách hoạt động

```
[run.js] đọc groups.txt + filter.json
   ↓
[webhook server] mở port :3000 đợi event từ extension
   ↓
[Playwright] launch Chromium có load extension + persistent FB session
   ↓
Loop từng group:
   ├─ navigate FB tab tới group URL
   ├─ mở popup extension ở tab riêng
   ├─ apply filter (days/posts count, include comments/attachments...)
   ├─ click Start
   └─ đợi extension POST webhook "export.completed" → next group
```

## Setup (lần đầu, ~15 phút)

### 1. Cài dependencies

```bash
cd /Users/xiaoqing/Downloads/fb-batch-scanner
npm install
npx playwright install chromium  # download Chromium binary
```

### 2. Cài cloudflared (cho webhook tunnel)

```bash
brew install cloudflared
```

### 3. Cấu hình `.env`

```bash
# .env đã sẵn — sửa WEBHOOK_SECRET thành random string
# Ví dụ macOS:
openssl rand -hex 16    # copy output làm WEBHOOK_SECRET
```

### 4. Điền group URLs vào `config/groups.txt`

1 URL / dòng. Comment bằng `#`. Ví dụ:
```
https://www.facebook.com/groups/javascript.vn
https://www.facebook.com/groups/codeforvn
```

### 5. Tùy chỉnh filter `config/filter.json`

Default: lấy posts trong **1 ngày gần nhất**, không include comments/attachments. Sửa theo nhu cầu.

Field reference:

| Field | Values | Mô tả |
|---|---|---|
| `fetchQuantity.mode` | `FETCH_ALL` / `BY_POST_COUNT` / `BY_DAYS_COUNT` | Chế độ lấy posts |
| `fetchQuantity.days` | 1-3650 | Dùng khi mode = BY_DAYS_COUNT |
| `fetchQuantity.postsCount` | 1-100000 | Dùng khi mode = BY_POST_COUNT |
| `options.includeComments` | true/false | Có lấy comments không |
| `options.includeNestingComments` | true/false | Lấy cả reply lồng nhau |
| `options.commentsLimitPerPost` | number | Max comment/post (0=unlimited) |
| `options.includeAttachments` | true/false | Tải ảnh/video về |
| `options.translateContent` | true/false | Dịch nội dung |
| `options.saveAsJSON` | true/false | Lưu `post.json` |
| `options.generateHTML` | true/false | Lưu `post.html` |
| `advanced.requestDelaySeconds` | 0-30 | Delay giữa request FB (chống flag) |

## Chạy hằng ngày

### Mở 2 terminal

**Terminal 1 — Tunnel:**
```bash
npm run tunnel
# → output: https://random-name-xyz.trycloudflare.com
# Copy URL này
```

**Setup webhook trong extension (lần đầu hoặc khi URL tunnel đổi):**

1. Chromium do Playwright launch sẽ mở. Vào `chrome://extensions/` → click "Details" của extension → click "Extension options"
2. Vào tab **Webhook Settings**
3. Set:
   - URL: `https://random-name-xyz.trycloudflare.com/webhook`
   - Auth Mode: **Header**
   - Header Name: `X-Secret`
   - Header Value: `<WEBHOOK_SECRET từ .env>`
4. Click **Save** → Allow domain
5. Click **Send Test** → check terminal 1 thấy log `[debug] webhook: test` → OK

**Terminal 2 — Run batch:**
```bash
npm start
```

Lần đầu sẽ pause để bro login Facebook trong cửa sổ Chromium → nhấn ENTER ở terminal để tiếp tục. Session sẽ persist vào `fb-session/` cho các lần sau.

## Output

### Logs

- Console: real-time màu sắc
- File: `logs/YYYY-MM-DD.jsonl` (newline-delimited JSON, parse được bằng `jq`)

### State

`state.json` lưu groups đã done/failed/skipped trong ngày. Chạy lại trong cùng ngày sẽ skip groups đã done.

### Posts được download bởi extension

Extension lưu vào:
```
~/Downloads/ESUIT Posts Exporter for Facebook/
└── <Tên group>/
    └── <post_id>/
        ├── post.json              (nếu saveAsJSON)
        ├── post.html              (nếu generateHTML)
        ├── comments.json          (nếu includeComments)
        ├── comments.csv           (nếu includeComments)
        ├── <image-1>.jpg          (nếu includeAttachments)
        ├── <video-1>.mp4
        └── ...
```

Folder name của group lấy từ tên FB hiển thị (vd "JavaScript Việt Nam").

## Schedule chạy tự động hằng ngày

Dùng `launchd` trên macOS:

```bash
# Tạo file plist
cat > ~/Library/LaunchAgents/com.qing.fbscan.daily.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>com.qing.fbscan.daily</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>cd /Users/xiaoqing/Downloads/fb-batch-scanner &amp;&amp; /usr/local/bin/node run.js</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>8</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/xiaoqing/Downloads/fb-batch-scanner/logs/launchd.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/xiaoqing/Downloads/fb-batch-scanner/logs/launchd.err</string>
</dict>
</plist>
EOF

# Load
launchctl load ~/Library/LaunchAgents/com.qing.fbscan.daily.plist
```

Note: cloudflared tunnel **vẫn cần chạy thủ công** mỗi ngày (URL đổi mỗi lần). Hoặc dùng **Named Tunnel** với account Cloudflare để URL cố định.

## Troubleshooting

### "Click Start failed"
Selector `button:has-text("Start")` không khớp. Update `lib/group-runner.js` → `SELECTORS.startButton`.

### "Timeout after 600000ms"
Extension không fire webhook. Check:
1. Tunnel còn running không? (`curl <tunnel-url>` should return some response)
2. Webhook URL trong extension settings có khớp tunnel URL không
3. `WEBHOOK_SECRET` trong `.env` có khớp Header Value trong extension settings không
4. Mở **Webhook Logs** trong extension xem có lỗi gì không

### Popup mở nhưng không inject vào FB page
Extension popup dùng `chrome.tabs.query({active: true, currentWindow: true})` — nếu popup tab là active thì sẽ inject vào CHÍNH popup → fail.

Workaround đã làm trong code: `fbPage.bringToFront()` trước khi click Start, nhưng Chromium có thể không respect.

Nếu vẫn fail → cần test thủ công 1 lần xem extension behavior thế nào, có thể phải sửa lại approach (vd: inject script trực tiếp bằng Playwright thay vì qua popup).

### FB checkpoint / login lại liên tục
- Tăng `GROUP_DELAY_MS` lên 15000-30000
- Tăng `requestDelaySeconds` trong filter.json lên 2-5
- Giảm số group / ngày nếu vẫn bị

## Reset

```bash
npm run reset-session    # logout FB
npm run reset-state      # clear progress (rescan từ đầu)
```

## Cấu trúc thư mục

```
fb-batch-scanner/
├── package.json
├── .env                    # secrets (ignored by git)
├── .env.example            # template
├── .gitignore
├── README.md               # file này
├── run.js                  # ⭐ entry point
│
├── config/
│   ├── groups.txt          # 50 group URL
│   └── filter.json         # filter chung
│
├── lib/
│   ├── webhook-server.js   # HTTP server :3000
│   ├── browser.js          # Playwright launcher
│   ├── group-runner.js     # scan logic per group
│   ├── state.js            # progress persist
│   └── logger.js           # logger
│
├── extension/              # SYMLINK → Qing Cracked extension
├── fb-session/             # auto-gen: FB cookies (gitignore)
├── logs/                   # daily logs (gitignore)
└── state.json              # progress (gitignore)
```
