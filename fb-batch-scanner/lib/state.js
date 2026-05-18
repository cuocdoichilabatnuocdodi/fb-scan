const fs = require('fs');

const DEFAULT_STATE = {
  startedAt: null,
  finishedAt: null,
  done: [],        // [{url, posts, at}]
  failed: [],      // [{url, err, at}]
  skipped: [],     // [{url, reason, at}]
};

function loadState(path) {
  if (!fs.existsSync(path)) return { ...DEFAULT_STATE };
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(path, 'utf8')) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(path, state) {
  fs.writeFileSync(path, JSON.stringify(state, null, 2));
}

function isDoneToday(state, url) {
  const today = new Date().toISOString().slice(0, 10);
  return state.done.some(d => d.url === url && d.at.startsWith(today));
}

module.exports = { loadState, saveState, isDoneToday };
