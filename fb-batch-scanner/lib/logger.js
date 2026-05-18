const fs = require('fs');
const path = require('path');

function ts() {
  return new Date().toISOString();
}

function createLogger(logDir, { debug = false } = {}) {
  fs.mkdirSync(logDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(logDir, `${date}.jsonl`);

  function write(level, msg, data) {
    const entry = { ts: ts(), level, msg, ...data };
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    const color = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[90m' }[level] || '';
    const reset = '\x1b[0m';
    const tail = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
    console.log(`${color}[${level.padEnd(5)}]${reset} ${msg}${tail}`);
  }

  return {
    info: (msg, data = {}) => write('info', msg, data),
    warn: (msg, data = {}) => write('warn', msg, data),
    error: (msg, data = {}) => write('error', msg, data),
    debug: (msg, data = {}) => debug && write('debug', msg, data),
  };
}

module.exports = { createLogger };
