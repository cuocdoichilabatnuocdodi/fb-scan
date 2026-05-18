const VALID_MODES = ['FETCH_ALL', 'BY_POST_COUNT', 'BY_DAYS_COUNT'];

class FilterConfigError extends Error {
  constructor(msg, hint) {
    super(hint ? `${msg}\n  → Hint: ${hint}` : msg);
    this.name = 'FilterConfigError';
  }
}

function isPosInt(v, { min = 1, max = Infinity } = {}) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && v === Math.trunc(v);
}

function isNonNegNum(v, { max = Infinity } = {}) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
}

function isBool(v) {
  return typeof v === 'boolean';
}

function validate(filter) {
  // ─── fetchQuantity ───────────────────────────────────────────
  const fq = filter.fetchQuantity;
  if (!fq || typeof fq !== 'object') {
    throw new FilterConfigError(
      'config/filter.json: `fetchQuantity` is missing or not an object',
      'add `"fetchQuantity": { "mode": "BY_DAYS_COUNT", "days": 1 }`'
    );
  }

  if (!VALID_MODES.includes(fq.mode)) {
    throw new FilterConfigError(
      `config/filter.json: \`fetchQuantity.mode\` = ${JSON.stringify(fq.mode)} is invalid`,
      `valid values: ${VALID_MODES.map(m => `"${m}"`).join(', ')}`
    );
  }

  if (fq.mode === 'BY_DAYS_COUNT') {
    if (!isPosInt(fq.days, { min: 1, max: 3650 })) {
      throw new FilterConfigError(
        `config/filter.json: mode=BY_DAYS_COUNT requires \`fetchQuantity.days\` (integer 1-3650), got ${JSON.stringify(fq.days)}`,
        fq._days != null
          ? 'looks like you have `_days` (underscore-prefixed) — rename to `days`'
          : 'add `"days": 1` inside `fetchQuantity`'
      );
    }
  }

  if (fq.mode === 'BY_POST_COUNT') {
    if (!isPosInt(fq.postsCount, { min: 1, max: 100000 })) {
      throw new FilterConfigError(
        `config/filter.json: mode=BY_POST_COUNT requires \`fetchQuantity.postsCount\` (integer 1-100000), got ${JSON.stringify(fq.postsCount)}`,
        fq._postsCount != null
          ? 'looks like you have `_postsCount` (underscore-prefixed) — rename to `postsCount`'
          : 'add `"postsCount": 50` inside `fetchQuantity`'
      );
    }
  }

  // ─── options ─────────────────────────────────────────────────
  const opts = filter.options || {};
  const boolFields = [
    'includeComments',
    'includeNestingComments',
    'includeAttachments',
    'translateContent',
    'saveAsJSON',
    'generateHTML',
  ];
  for (const k of boolFields) {
    if (opts[k] !== undefined && !isBool(opts[k])) {
      throw new FilterConfigError(
        `config/filter.json: \`options.${k}\` must be true/false, got ${JSON.stringify(opts[k])}`
      );
    }
  }

  if (opts.includeNestingComments === true && opts.includeComments !== true) {
    throw new FilterConfigError(
      'config/filter.json: `options.includeNestingComments: true` requires `options.includeComments: true`',
      'nesting comments are replies to comments — must fetch comments first'
    );
  }

  if (opts.commentsLimitPerPost !== undefined && !isNonNegNum(opts.commentsLimitPerPost, { max: 100000 })) {
    throw new FilterConfigError(
      `config/filter.json: \`options.commentsLimitPerPost\` must be a non-negative number ≤ 100000, got ${JSON.stringify(opts.commentsLimitPerPost)}`,
      '0 = unlimited'
    );
  }

  // ─── advanced ────────────────────────────────────────────────
  const adv = filter.advanced || {};
  if (adv.requestDelaySeconds !== undefined && !isNonNegNum(adv.requestDelaySeconds, { max: 60 })) {
    throw new FilterConfigError(
      `config/filter.json: \`advanced.requestDelaySeconds\` must be 0-60, got ${JSON.stringify(adv.requestDelaySeconds)}`
    );
  }

  // ─── warnings (non-fatal, returned for logging) ──────────────
  const warnings = [];

  if (opts.includeAttachments === true && opts.saveAsJSON !== true && opts.generateHTML !== true) {
    warnings.push('includeAttachments=true but neither saveAsJSON nor generateHTML — attachments will download but you have no post metadata file to link them');
  }

  if (fq.mode === 'FETCH_ALL') {
    warnings.push('mode=FETCH_ALL has no limit — large groups can take hours per group');
  }

  if (fq.mode === 'BY_DAYS_COUNT' && fq.days > 30) {
    warnings.push(`mode=BY_DAYS_COUNT with days=${fq.days} — long range, may take significant time per group`);
  }

  return { warnings };
}

module.exports = { validate, FilterConfigError };
