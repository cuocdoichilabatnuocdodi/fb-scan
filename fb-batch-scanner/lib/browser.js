const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

function cleanStaleLocks(sessionDir, logger) {
  const lockNames = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  let removed = 0;
  for (const name of lockNames) {
    const p = path.join(sessionDir, name);
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink() || st.isFile()) { fs.unlinkSync(p); removed++; }
    } catch {}
  }
  if (removed > 0) logger.debug(`cleaned ${removed} stale Chromium lock file(s)`);
}

async function waitForCdp(port, timeoutMs, logger) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
          if (res.statusCode === 200) { res.resume(); resolve(); }
          else { res.resume(); reject(new Error('not ready')); }
        });
        req.on('error', reject);
        req.setTimeout(1000, () => req.destroy(new Error('timeout')));
      });
      return true;
    } catch { await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error(`CDP port ${port} not ready after ${timeoutMs}ms`);
}

async function launchBrowser({ extensionPath, sessionDir, downloadRoot, headless = false, logger }) {
  if (headless) {
    logger.warn('headless not supported with extension — forcing headless=false');
    headless = false;
  }

  if (fs.existsSync(sessionDir)) cleanStaleLocks(sessionDir, logger);

  function setDownloadDirInPrefs(sessionDir, dlRoot) {
    const prefsPath = path.join(sessionDir, 'Default', 'Preferences');
    if (!fs.existsSync(prefsPath)) return;  // first-launch — Chromium will create it
    try {
      const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
      prefs.download = prefs.download || {};
      prefs.download.default_directory = dlRoot;
      prefs.download.prompt_for_download = false;
      prefs.profile = prefs.profile || {};
      prefs.profile.default_content_setting_values = prefs.profile.default_content_setting_values || {};
      prefs.profile.default_content_setting_values.automatic_downloads = 1;
      fs.writeFileSync(prefsPath, JSON.stringify(prefs));
    } catch {}
  }

  const home = require('os').homedir();
  const resolvePath = (p) => {
    if (!p) return '';
    let r = p.replace(/^~(?=\/|$)/, home);
    return path.isAbsolute(r) ? r : path.resolve(r);
  };
  const absExtPath = resolvePath(extensionPath);
  const absSessionDir = resolvePath(sessionDir);
  const dlRoot = downloadRoot && downloadRoot.trim()
    ? resolvePath(downloadRoot)
    : path.join(home, 'Downloads');
  if (!fs.existsSync(dlRoot)) fs.mkdirSync(dlRoot, { recursive: true });
  setDownloadDirInPrefs(absSessionDir, dlRoot);
  logger.info(`download root: ${dlRoot}`);

  // Locate Chromium binary that Playwright installed
  const chromiumExe = chromium.executablePath();

  // Spawn Chromium ourselves with --remote-debugging-port so connectOverCDP
  // attaches WITHOUT Playwright's download interception. Downloads handled
  // natively by Chromium → land at --download-default-directory with proper
  // filenames + subfolder structure.
  const port = 9222 + Math.floor(Math.random() * 1000);
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${absSessionDir}`,
    `--disable-extensions-except=${absExtPath}`,
    `--load-extension=${absExtPath}`,
    `--download-default-directory=${dlRoot}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    'about:blank',
  ];

  logger.debug(`spawning chromium at port ${port}`);
  const proc = spawn(chromiumExe, args, {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => {
    const s = d.toString();
    if (s.includes('DevTools listening') || s.includes('error') || s.includes('Error')) {
      logger.debug(`[chromium] ${s.trim().slice(0, 200)}`);
    }
  });

  try { await waitForCdp(port, 20000, logger); }
  catch (e) { proc.kill('SIGKILL'); throw e; }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const [context] = browser.contexts();
  if (!context) throw new Error('no browser context after connect');

  let [sw] = context.serviceWorkers();
  if (!sw) {
    try { sw = await context.waitForEvent('serviceworker', { timeout: 20000 }); }
    catch { logger.warn('service worker not detected within 20s'); }
  }
  const extId = sw ? sw.url().split('/')[2] : 'unknown';
  logger.info('extension loaded', { extId, mode: 'CDP-attached' });

  // Graceful shutdown: SIGTERM → wait → SIGKILL only if still alive.
  // SIGKILL alone corrupts profile (Chrome can't flush cookies/IndexedDB) →
  // FB session lost, user has to login again.
  const cleanup = async () => {
    if (proc.killed || proc.exitCode !== null) return;
    try {
      proc.kill('SIGTERM');
      // Wait up to 5s for graceful exit
      await Promise.race([
        new Promise(res => proc.once('exit', res)),
        new Promise(res => setTimeout(res, 5000)),
      ]);
      if (!proc.killed && proc.exitCode === null) {
        proc.kill('SIGKILL');
      }
    } catch {}
  };
  const sigHandler = (code) => async () => { await cleanup(); process.exit(code); };
  process.once('SIGINT', sigHandler(130));
  process.once('SIGTERM', sigHandler(0));

  return { context, extId, sw, browser, _proc: proc, _cleanup: cleanup };
}

async function ensureLoggedIn({ context, logger }) {
  const pages = context.pages();
  let page = pages.find(p => !p.url().startsWith('chrome-extension://')) || pages[0];
  if (!page) page = await context.newPage();

  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  if (page.url().includes('/login') || page.url().includes('/checkpoint')) {
    logger.warn('NOT LOGGED IN');
    console.log('\n┌─────────────────────────────────────────────────┐');
    console.log('│  Please log in to Facebook in the opened window │');
    console.log('│  Then press ENTER here to continue              │');
    console.log('└─────────────────────────────────────────────────┘\n');
    await new Promise(resolve => {
      process.stdin.resume();
      process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
    });
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/login')) throw new Error('Still not logged in. Aborting.');
  }

  logger.info('logged in OK');
  return page;
}

module.exports = { launchBrowser, ensureLoggedIn };
