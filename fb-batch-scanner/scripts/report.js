#!/usr/bin/env node
/**
 * Report generator — đọc runs.jsonl và in báo cáo.
 *
 * Usage:
 *   node scripts/report.js                  # all runs, all time
 *   node scripts/report.js --today          # only today
 *   node scripts/report.js --date 2026-05-18
 *   node scripts/report.js --run <runId>    # filter by batch run UUID
 *   node scripts/report.js --json           # output raw JSON instead of table
 */

const fs = require('fs');
const path = require('path');

const RUNS_FILE = path.resolve(__dirname, '..', 'runs.jsonl');

function loadRuns() {
  if (!fs.existsSync(RUNS_FILE)) return [];
  return fs.readFileSync(RUNS_FILE, 'utf8')
    .split('\n')
    .filter(s => s.trim())
    .map(s => { try { return JSON.parse(s); } catch { return null; } })
    .filter(Boolean);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { json: false, today: false, date: null, run: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--today') out.today = true;
    else if (args[i] === '--date') out.date = args[++i];
    else if (args[i] === '--run') out.run = args[++i];
    else if (args[i] === '--json') out.json = true;
  }
  if (out.today) out.date = new Date().toISOString().slice(0, 10);
  return out;
}

function filterRuns(runs, opts) {
  return runs.filter(r => {
    if (opts.date && !r.ts.startsWith(opts.date)) return false;
    if (opts.run && r.runId !== opts.run) return false;
    return true;
  });
}

function fmtDate(iso) {
  return iso.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function statusEmoji(s) {
  return ({ completed: '✓', stopped: '⊘', failed: '✗', skipped: '↷' })[s] || '?';
}

function table(runs) {
  if (!runs.length) { console.log('No runs found.'); return; }

  // Group by runId
  const batches = new Map();
  for (const r of runs) {
    if (!batches.has(r.runId)) batches.set(r.runId, []);
    batches.get(r.runId).push(r);
  }

  let grandTotal = 0;
  let grandDur = 0;

  for (const [runId, items] of batches) {
    const first = items[0];
    const totalPosts = items.reduce((s, r) => s + (r.posts || 0), 0);
    const totalDur = items.reduce((s, r) => s + (r.durationSec || 0), 0);
    const byStatus = items.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});

    grandTotal += totalPosts;
    grandDur += totalDur;

    console.log(`\nBatch ${runId.slice(0, 8)}…  started ${fmtDate(first.ts)}`);
    console.log(`  Groups: ${items.length}  |  Posts: ${totalPosts}  |  Duration: ${totalDur.toFixed(1)}s  |  ${Object.entries(byStatus).map(([k, v]) => `${statusEmoji(k)}${k}=${v}`).join('  ')}`);
    console.log('  ──────────────────────────────────────────────────────────────────');
    console.log('   #  Status  Posts  Dur(s)  Group Name'.padEnd(60) + 'URL');
    items.forEach((r, idx) => {
      const line = [
        String(idx + 1).padStart(3),
        statusEmoji(r.status).padEnd(2),
        String(r.posts || 0).padStart(5),
        (r.durationSec || 0).toFixed(1).padStart(6),
        truncate(r.name || '(no title)', 30).padEnd(32),
        truncate(r.url, 60),
      ].join('  ');
      console.log(`  ${line}`);
      if (r.error) console.log(`        └─ error: ${r.error}`);
    });
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`Grand total: ${runs.length} group scans  |  ${grandTotal} posts  |  ${grandDur.toFixed(1)}s total`);
}

function main() {
  const opts = parseArgs();
  let runs = loadRuns();
  runs = filterRuns(runs, opts);

  if (opts.json) {
    console.log(JSON.stringify(runs, null, 2));
  } else {
    table(runs);
  }
}

main();
