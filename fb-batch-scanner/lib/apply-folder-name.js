/**
 * Patch extension's brand constant — controls output subfolder name.
 *
 * The extension uses `const s = "<brand>"` at IIFE top in injects/index.js for:
 *   1. Output subfolder root: ~/Downloads/<vt(s)>/<group>/<post>/
 *   2. Modal title display: "<s> v2.19.0"
 *
 * → Changing this single const affects BOTH. Trade-off of simplicity.
 *
 * Empty/missing env → restores to original brand "Qing Cracked | Posts Exporter for Facebook™"
 * Set env → patches to that value
 *
 * Patch is idempotent: re-run with same value = no-op.
 */

const fs = require('fs');
const path = require('path');

const ORIGINAL_BRAND = 'Qing Cracked | Posts Exporter for Facebook™';
const BRAND_REGEX = /(!function\(e,t,n,o,r\)\{"use strict";const s=")([^"]+)(")/;

function applyFolderName(extensionPath, override, logger) {
  const filePath = path.join(extensionPath, 'injects', 'index.js');
  if (!fs.existsSync(filePath)) {
    logger.warn(`injects/index.js not found at ${filePath} — folder name patch skipped`);
    return;
  }

  const src = fs.readFileSync(filePath, 'utf8');
  const m = src.match(BRAND_REGEX);
  if (!m) {
    logger.warn('extension brand constant pattern not found — folder name patch skipped (extension layout changed?)');
    return;
  }

  const current = m[2];
  const desired = (override && override.trim()) ? override.trim() : ORIGINAL_BRAND;

  if (current === desired) {
    logger.debug(`folder/brand already "${current}" — no patch needed`);
    return;
  }

  // Reject names with double-quote (would break the JS string literal)
  if (desired.includes('"')) {
    logger.error(`folder name must not contain double-quote: ${JSON.stringify(desired)}`);
    return;
  }

  const patched = src.replace(BRAND_REGEX, `$1${desired}$3`);
  fs.writeFileSync(filePath, patched);
  logger.info(`patched folder/brand: "${current}" → "${desired}"`);
}

module.exports = { applyFolderName, ORIGINAL_BRAND };
