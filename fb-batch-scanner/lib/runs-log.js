/**
 * runs.jsonl appender — one structured line per group scan.
 *
 * Each line contains everything needed for reporting:
 *   runId, groupId (uuid), ts, url, name, collectionId,
 *   status (completed/stopped/failed/skipped), posts, durationSec, error
 *
 * Read via: `cat runs.jsonl | jq` or `node scripts/report.js`
 */

const fs = require('fs');
const crypto = require('crypto');

function appendRun(file, entry) {
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}

function newId() {
  return crypto.randomUUID();
}

module.exports = { appendRun, newId };
