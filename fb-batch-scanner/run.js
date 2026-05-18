#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { startServer } = require('./lib/webhook-server');
const { launchBrowser, ensureLoggedIn } = require('./lib/browser');
const { runGroup } = require('./lib/group-runner');
const { loadState, saveState } = require('./lib/state');
const { createLogger } = require('./lib/logger');
const { validate: validateFilter, FilterConfigError } = require('./lib/validate-filter');
const { appendRun, newId } = require('./lib/runs-log');
const { applyFolderName } = require('./lib/apply-folder-name');
const { setupWebhookConfig } = require('./lib/setup-webhook');
const { installDownloadHook, relocateDownloads } = require('./lib/download-relocator');

function parseGroups(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#'));
}

function loadFilterRaw(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function cleanFilter(raw) {
  // strip _note / $schema_note keys for runtime use
  function clean(obj) {
    if (Array.isArray(obj)) return obj.map(clean);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith('_') || k.startsWith('$')) continue;
        out[k] = clean(v);
      }
      return out;
    }
    return obj;
  }
  return clean(raw);
}

async function main() {
  const cfg = {
    port: Number(process.env.PORT || 3000),
    secret: process.env.WEBHOOK_SECRET,
    publicUrl: process.env.PUBLIC_WEBHOOK_URL,
    extPath: process.env.EXTENSION_PATH,
    sessionDir: process.env.FB_SESSION_DIR || './fb-session',
    downloadRoot: process.env.DOWNLOAD_ROOT || '',  // empty → ~/Downloads default
    outputFolderName: process.env.OUTPUT_FOLDER_NAME || '',  // empty → keep extension default
    delayMs: Number(process.env.GROUP_DELAY_MS || 8000),
    timeoutMs: Number(process.env.GROUP_TIMEOUT_MS || 600000),
    pageLoadWaitMs: Number(process.env.PAGE_LOAD_WAIT_MS || 3000),
    headless: process.env.HEADLESS === 'true',
    debug: process.env.DEBUG === 'true',
  };

  const logger = createLogger('./logs', { debug: cfg.debug });

  // Resolve ext path early (relative supported; same logic as browser.js)
  const home = require('os').homedir();
  if (cfg.extPath) {
    let r = cfg.extPath.replace(/^~(?=\/|$)/, home);
    cfg.extPath = path.isAbsolute(r) ? r : path.resolve(r);
  }

  // ── Validate ───────────────────────────────────────────────────
  if (!cfg.extPath || !fs.existsSync(cfg.extPath)) {
    logger.error('EXTENSION_PATH not set or does not exist', { path: cfg.extPath });
    process.exit(1);
  }
  if (!cfg.secret || cfg.secret.startsWith('CHANGE_ME')) {
    logger.warn('WEBHOOK_SECRET is still default — webhook auth disabled until you set one');
  }
  if (!cfg.publicUrl) {
    logger.warn('PUBLIC_WEBHOOK_URL not set — make sure cloudflared tunnel is running and the URL is configured in extension webhook settings');
  }

  const groups = parseGroups('./config/groups.txt');

  // Load + validate filter (validate against RAW so we can detect _-prefixed mistakes)
  const rawFilter = loadFilterRaw('./config/filter.json');
  let filter, warnings;
  try {
    ({ warnings } = validateFilter(rawFilter));
    filter = cleanFilter(rawFilter);
  } catch (e) {
    if (e instanceof FilterConfigError) {
      logger.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  for (const w of warnings || []) logger.warn(`filter: ${w}`);

  const state = loadState('./state.json');

  if (groups.length === 0) {
    logger.error('no groups in config/groups.txt');
    process.exit(1);
  }

  state.startedAt = new Date().toISOString();
  logger.info(`batch start`, {
    totalGroups: groups.length,
    filter: filter.fetchQuantity,
  });

  // ── Webhook server ─────────────────────────────────────────────
  const ws = startServer({ port: cfg.port, secret: cfg.secret, logger });
  await ws.start();

  if (cfg.publicUrl) {
    logger.info(`webhook URL to configure in extension: ${cfg.publicUrl}/webhook`);
    logger.info(`auth header: X-Secret: ${cfg.secret}`);
  }

  // ── Apply output folder name patch (before browser launches so extension reads new value) ─
  applyFolderName(cfg.extPath, cfg.outputFolderName, logger);

  // ── Browser ────────────────────────────────────────────────────
  const { context, extId, sw, _cleanup: killChromium } = await launchBrowser({
    extensionPath: cfg.extPath,
    sessionDir: cfg.sessionDir,
    downloadRoot: cfg.downloadRoot,
    headless: cfg.headless,
    logger,
  });

  // Push webhook config into extension storage (handles ext-id changes / fresh profiles)
  await setupWebhookConfig(sw, { port: cfg.port, secret: cfg.secret, logger });

  // Install chrome.downloads.download hook to capture intended filenames
  // (Playwright intercepts downloads → files get UUID names; this lets us recover them)
  await installDownloadHook(sw, logger);

  const fbPage = await ensureLoggedIn({ context, logger });

  // ── Loop groups ────────────────────────────────────────────────
  const runId = newId();  // single UUID for this batch invocation
  const RUNS_FILE = './runs.jsonl';

  for (let i = 0; i < groups.length; i++) {
    const url = groups[i];
    const tag = `[${i + 1}/${groups.length}]`;
    const groupId = newId();
    const startedAt = Date.now();
    const startedAtIso = new Date().toISOString();

    function record(status, extra = {}) {
      appendRun(RUNS_FILE, {
        runId, groupId, ts: startedAtIso,
        url,
        name: extra.name ?? null,
        collectionId: extra.collectionId ?? null,
        status,
        posts: extra.posts ?? 0,
        durationSec: +((Date.now() - startedAt) / 1000).toFixed(1),
        error: extra.error ?? null,
      });
    }

    logger.info(`${tag} ──────────────────────────────────────────`);

    let lastResult = null;
    try {
      const result = await runGroup({
        context,
        extId,
        fbPage,
        sw,
        url,
        filter,
        emitter: ws.emitter,
        timeoutMs: cfg.timeoutMs,
        pageLoadWaitMs: cfg.pageLoadWaitMs,
        logger,
      });

      lastResult = result;
      const durSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      const meta = {
        name: result.groupName,
        collectionId: result.data?.collectionId,
        posts: result.data?.totalPosts || 0,
      };

      if (result.event === 'export.completed') {
        logger.info(`${tag} DONE in ${durSec}s`, { posts: meta.posts, name: meta.name, url });
        state.done.push({ url, posts: meta.posts, at: startedAtIso });
        record('completed', meta);
      } else {
        logger.warn(`${tag} stopped/failed`, { event: result.event, url });
        state.failed.push({ url, err: result.event, posts: meta.posts, at: startedAtIso });
        record(result.event.replace('export.', ''), { ...meta, error: result.event });
      }
    } catch (e) {
      logger.error(`${tag} exception: ${e.message}`, { url });
      state.failed.push({ url, err: e.message, at: startedAtIso });
      record('failed', { error: e.message });
    }

    saveState('./state.json', state);

    // Relocate intercepted downloads (UUID temp → proper paths with prefixes)
    const home2 = require('os').homedir();
    let dlRoot = cfg.downloadRoot && cfg.downloadRoot.trim()
      ? cfg.downloadRoot.replace(/^~(?=\/|$)/, home2)
      : path.join(home2, 'Downloads');
    if (!path.isAbsolute(dlRoot)) dlRoot = path.resolve(dlRoot);
    // Extract FB group ID: prefer URL numeric segment, fall back to webhook collectionId
    const urlMatch = url.match(/\/groups\/(\d+)/);
    const fbGroupId = urlMatch ? urlMatch[1] : (lastResult && lastResult.data && lastResult.data.collectionId) || null;
    await relocateDownloads(sw, dlRoot, {
      groupId: fbGroupId,
      addGroupIdPrefix: true,
      addPostIdPrefix: true,
      startedAfter: startedAtIso,  // only downloads from this scan
    }, logger);

    if (i < groups.length - 1) {
      logger.debug(`waiting ${cfg.delayMs}ms before next group...`);
      await new Promise(r => setTimeout(r, cfg.delayMs));
    }
  }

  // ── Done ───────────────────────────────────────────────────────
  state.finishedAt = new Date().toISOString();
  saveState('./state.json', state);

  logger.info('═══════════════════════════════════════');
  logger.info('BATCH COMPLETE', {
    done: state.done.length,
    failed: state.failed.length,
    skipped: state.skipped.length,
  });
  if (state.failed.length) {
    logger.warn('Failed groups:');
    state.failed.forEach(f => logger.warn(`  ✗ ${f.url} — ${f.err}`));
  }

  try { await context.close(); } catch {}
  if (typeof killChromium === 'function') await killChromium();
  await ws.stop();
  process.exit(0);
}

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
  process.exit(1);
});

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
