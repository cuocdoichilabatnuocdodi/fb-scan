/*
 * GROUP RUNNER
 *
 * Architecture (verified by inspection):
 *   - Extension injects "Download These Posts" button into FB group/page header
 *   - Clicking that button opens a MODAL on the FB page (rendered by content script)
 *   - Modal contains: filter radios, options checkboxes, Start button
 *   - Everything happens on the same FB tab — NO chrome-extension://popup needed
 *
 * Flow per group:
 *   1. fbPage.goto(groupUrl)
 *   2. Wait for "Download These Posts" button (extension injected)
 *   3. Click it → modal appears
 *   4. Apply filter (mode + days/posts + options)
 *   5. Click "Start" → scan runs in background
 *   6. Wait for webhook event "export.completed" (or stopped/failed)
 *   7. Done — modal may close itself or stay; doesn't matter, next iter will re-open
 */

const SELECTORS = {
  triggerButton: 'text="Download These Posts"',
  fetchAllRadio: 'label:has-text("Fetch ALL") input[type="radio"]',
  byPostCountRadio: 'label:has-text("By posts count") input[type="radio"]',
  byDaysCountRadio: 'label:has-text("By days count") input[type="radio"]',
  // Checkboxes: text patterns flexible (may have trailing ❓ emoji)
  cbIncludeComments: 'label:has-text("Including Comments") input[type="checkbox"]',
  cbIncludeAttachments: 'label:has-text("Including Attachments") input[type="checkbox"]',
  cbTranslateContent: 'label:has-text("Translate Content") input[type="checkbox"]',
  cbGenHTML: 'label:has-text("Gen-HTML") input[type="checkbox"]',
  cbSavePostJSON: 'label:has-text("Save Post.json") input[type="checkbox"]',
  cbWebhook: 'label:has-text("Webhook") input[type="checkbox"]',
  startButton: 'button:has-text("Start"):not(:has-text("Resume"))',
};

async function waitForFbGroupLoaded(page, { extraWaitMs, logger }) {
  // Wait for either the feed or the inject button
  try {
    await Promise.race([
      page.waitForSelector('[role="feed"]', { timeout: 30000 }),
      page.waitForSelector(SELECTORS.triggerButton, { timeout: 30000 }),
    ]);
  } catch {
    logger.warn('FB page elements not detected — group may be private/blocked or layout changed');
  }
  await page.waitForTimeout(extraWaitMs);
}

async function setCheckbox(page, selector, desired, label, logger) {
  try {
    const cb = page.locator(selector).first();
    const exists = await cb.count() > 0;
    if (!exists) {
      logger.warn(`checkbox not found: ${label}`);
      return;
    }
    const before = await cb.isChecked();
    if (before === desired) {
      logger.debug(`${label} already ${desired}`);
      return;
    }
    // Antd checkbox: clicking the <input> directly with force triggers React's onChange.
    // Clicking the wrapping <label> sometimes only toggles DOM, not React state.
    await cb.setChecked(desired, { force: true });
    await page.waitForTimeout(150);
    const after = await cb.isChecked();
    if (after !== desired) {
      logger.warn(`${label}: setChecked did not stick (still ${after}) — trying label click`);
      await page.locator(`label:has-text("${label}")`).first().click();
      await page.waitForTimeout(150);
    }
    logger.debug(`set ${label} → ${desired}`);
  } catch (e) {
    logger.warn(`could not set ${label}`, { err: e.message });
  }
}

async function applyFilter(page, filter, logger) {
  // 1) Options checkboxes
  await setCheckbox(page, SELECTORS.cbIncludeComments, !!filter.options.includeComments, 'Including Comments', logger);
  await setCheckbox(page, SELECTORS.cbIncludeAttachments, !!filter.options.includeAttachments, 'Including Attachments', logger);
  await setCheckbox(page, SELECTORS.cbTranslateContent, !!filter.options.translateContent, 'Translate Content', logger);
  await setCheckbox(page, SELECTORS.cbGenHTML, !!filter.options.generateHTML, 'Gen-HTML', logger);
  await setCheckbox(page, SELECTORS.cbSavePostJSON, !!filter.options.saveAsJSON, 'Save Post.json', logger);
  // Webhook MUST be enabled for our coordination (script waits for export.completed event)
  await setCheckbox(page, SELECTORS.cbWebhook, true, 'Webhook', logger);

  // 2) Fetch quantity mode
  const mode = filter.fetchQuantity.mode;
  try {
    if (mode === 'FETCH_ALL') {
      await page.locator('label:has-text("Fetch ALL")').first().click();
    } else if (mode === 'BY_POST_COUNT') {
      await page.locator('label:has-text("By posts count")').first().click();
      await page.waitForTimeout(400);
      // Set posts count via InputNumber (added by earlier UI patch)
      const inputs = page.locator('input[role="spinbutton"]');
      const last = inputs.nth(await inputs.count() - 1);
      await last.click({ clickCount: 3 });
      await last.type(String(filter.fetchQuantity.postsCount));
      await last.press('Enter');
      logger.debug(`postsCount set to ${filter.fetchQuantity.postsCount}`);
    } else if (mode === 'BY_DAYS_COUNT') {
      await page.locator('label:has-text("By days count")').first().click();
      await page.waitForTimeout(400);
      const days = filter.fetchQuantity.days;
      if ([3, 7, 10, 30].includes(days)) {
        // Click preset radio button (Radio.Group with optionType=button)
        await page.locator(`label:has-text("${days} days")`).first().click();
        logger.debug(`preset clicked: ${days} days`);
      } else {
        await page.locator('label:has-text("Custom")').first().click();
        await page.waitForTimeout(500);
        const inputs = page.locator('input[role="spinbutton"]');
        const last = inputs.nth(await inputs.count() - 1);
        await last.click({ clickCount: 3 });
        await last.type(String(days));
        await last.press('Enter');
        await page.waitForTimeout(200);
        logger.debug(`custom days set to ${days}`);
      }
    }
  } catch (e) {
    logger.warn(`could not set fetch mode/value`, { err: e.message });
  }

  logger.debug('filter applied', { mode, ...filter.fetchQuantity });
}

async function runGroup({ context, fbPage, url, filter, emitter, timeoutMs, pageLoadWaitMs, logger }) {
  // 1. Navigate to group
  logger.info(`navigating: ${url}`);
  await fbPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForFbGroupLoaded(fbPage, { extraWaitMs: pageLoadWaitMs, logger });

  // Extract group name from page title (e.g. "(19) GearVN - Chợ PC & Gaming Gear | Facebook")
  let groupName = null;
  try {
    const title = await fbPage.title();
    groupName = title.replace(/^\(\d+\)\s*/, '').replace(/\s*\|\s*Facebook$/, '').trim() || null;
  } catch {}

  // 2. Click "Download These Posts" to open modal
  const trigger = fbPage.locator(SELECTORS.triggerButton).first();
  const triggerExists = await trigger.count() > 0;
  if (!triggerExists) {
    throw new Error(`"Download These Posts" button not found — group inaccessible or extension not injected`);
  }
  // Dispatch native .click() via JS — bypasses FB overlays that intercept pointer events
  await trigger.evaluate(el => el.click());
  logger.debug('opened scan modal');

  // 3. Wait for modal to render (Start button is good signal)
  try {
    await fbPage.waitForSelector(SELECTORS.startButton, { timeout: 10000 });
  } catch {
    throw new Error('scan modal did not appear after clicking trigger');
  }
  await fbPage.waitForTimeout(800);

  // 4. Apply filter
  try {
    await applyFilter(fbPage, filter, logger);
  } catch (e) {
    logger.warn('applyFilter exception (continuing with whatever was set)', { err: e.message });
  }

  // 5. Set up webhook completion listener BEFORE clicking Start.
  // Also capture collectionId from earlier events (posts.batch / export.start)
  // since it's NOT in export.completed payload.
  let capturedCollectionId = null;
  const completionPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      emitter.off('event', handler);
      reject(new Error(`timeout after ${timeoutMs}ms (no webhook event received — check tunnel/url/secret)`));
    }, timeoutMs);

    const handler = (payload) => {
      if (payload.data && payload.data.collectionId && !capturedCollectionId) {
        capturedCollectionId = payload.data.collectionId;
      }
      if (['export.completed', 'export.stopped', 'export.failed'].includes(payload.event)) {
        clearTimeout(timeout);
        emitter.off('event', handler);
        // Inject collectionId into result so callers can read it
        if (capturedCollectionId) {
          payload.data = payload.data || {};
          payload.data.collectionId = payload.data.collectionId || capturedCollectionId;
        }
        resolve(payload);
      }
    };
    emitter.on('event', handler);
  });

  // 6. Click Start
  try {
    await fbPage.locator(SELECTORS.startButton).first().click({ timeout: 10000 });
    logger.info('clicked Start, waiting for completion...');
  } catch (e) {
    throw new Error(`could not click Start button: ${e.message}`);
  }

  // 7. Wait for completion event
  const result = await completionPromise;
  result.groupName = groupName;
  return result;
}

module.exports = { runGroup };
