/**
 * Capture intended filenames from chrome.downloads.download (which Playwright
 * intercepts), then relocate temp files to proper paths under dlRoot.
 *
 * Path transform options:
 *   - addGroupIdPrefix → "<group>" becomes "[<groupId>]-<group>"
 *   - addPostIdPrefix  → "<timestamp>" becomes "[<postId>]-<timestamp>"
 *   (post_id is extracted from post.json content at copy time)
 */

const fs = require('fs');
const path = require('path');

async function installDownloadHook(sw, logger) {
  if (!sw) { logger.warn('download hook skipped — no SW'); return; }
  try {
    await sw.evaluate(() => {
      if (self.__qingDownloadMap) return;
      self.__qingDownloadMap = new Map();
      const orig = chrome.downloads.download;
      chrome.downloads.download = function (options, cb) {
        const intended = options && options.filename;
        return new Promise((resolve, reject) => {
          const wrapped = (id) => {
            if (chrome.runtime.lastError) {
              if (cb) cb(id);
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (id != null && intended) self.__qingDownloadMap.set(id, intended);
            if (cb) cb(id);
            resolve(id);
          };
          try { orig.call(chrome.downloads, options, wrapped); }
          catch (e) { reject(e); }
        });
      };
    });
    logger.debug('download hook installed in extension SW');
  } catch (e) {
    logger.warn(`download hook install failed: ${e.message}`);
  }
}

function transformPath(intended, ctx) {
  // intended: "<extSubfolder>/<groupName>/<timestamp>/[attachments/]<file>"
  const parts = intended.split('/');
  if (parts.length < 4) return intended;
  const origGroupName = parts[1];
  const origTimestamp = parts[2];

  if (ctx.addGroupIdPrefix && ctx.groupId && !parts[1].startsWith(`${ctx.groupId}#`)) {
    parts[1] = `${ctx.groupId}#${parts[1]}`;
  }
  if (ctx.addPostIdPrefix) {
    const key = `${origGroupName}/${origTimestamp}`;
    const postId = ctx.postIdMap.get(key);
    if (postId && !parts[2].startsWith(`${postId}#`)) {
      parts[2] = `${postId}#${parts[2]}`;
    }
  }
  return parts.join('/');
}

async function relocateDownloads(sw, dlRoot, options, logger) {
  if (!sw) return;
  const opts = {
    groupId: options.groupId || null,
    addGroupIdPrefix: options.addGroupIdPrefix !== false,
    addPostIdPrefix: options.addPostIdPrefix !== false,
  };
  logger.debug(`relocate opts: groupId=${opts.groupId} addGroup=${opts.addGroupIdPrefix} addPost=${opts.addPostIdPrefix}`);

  let items;
  try {
    const startedAfter = options.startedAfter || null;  // ISO timestamp — only downloads from current scan
    items = await sw.evaluate((startedAfter) => new Promise((resolve) => {
      const query = { state: 'complete', orderBy: ['-startTime'], limit: 5000 };
      if (startedAfter) query.startedAfter = startedAfter;
      chrome.downloads.search(query, (results) => {
        const map = self.__qingDownloadMap || new Map();
        resolve(results.map((d) => ({
          id: d.id,
          tempPath: d.filename,
          intended: map.get(d.id) || null,
        })));
      });
    }), startedAfter);
  } catch (e) {
    logger.warn(`relocate failed (chrome.downloads.search): ${e.message}`);
    return;
  }

  // Pass 1: build postIdMap from post.json contents
  const postIdMap = new Map();
  for (const item of items) {
    if (!item.intended || !item.tempPath) continue;
    if (!item.intended.endsWith('/post.json')) continue;
    if (!fs.existsSync(item.tempPath)) continue;
    try {
      // Extension writes post.json with UTF-8 BOM — strip before parse
      const raw = fs.readFileSync(item.tempPath, 'utf8').replace(/^﻿/, '');
      const content = JSON.parse(raw);
      const postId = content.post_id || content.postId;
      const parts = item.intended.split('/');
      if (postId && parts.length >= 4) {
        const key = `${parts[parts.length - 3]}/${parts[parts.length - 2]}`;
        postIdMap.set(key, postId);
      }
    } catch {}
  }

  logger.debug(`postIdMap entries: ${postIdMap.size}`);

  // Pass 2: transform + copy
  const ctx = { ...opts, postIdMap };
  let moved = 0, skipped = 0, missing = 0;
  let sampleLogged = false;
  for (const item of items) {
    if (!item.intended) { skipped++; continue; }
    if (!item.tempPath || !fs.existsSync(item.tempPath)) { missing++; continue; }
    const transformedPath = transformPath(item.intended, ctx);
    if (!sampleLogged) {
      logger.debug(`sample intended: ${item.intended}`);
      logger.debug(`sample transformed: ${transformedPath}`);
      sampleLogged = true;
    }
    const target = path.join(dlRoot, transformedPath);
    if (fs.existsSync(target) && fs.statSync(target).size === fs.statSync(item.tempPath).size) continue;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(item.tempPath, target);
      moved++;
    } catch (e) {
      logger.warn(`copy failed for ${transformedPath}: ${e.message}`);
    }
  }
  logger.info(`relocate: moved=${moved} skipped=${skipped} missing=${missing} total=${items.length}`);
}

module.exports = { installDownloadHook, relocateDownloads };
