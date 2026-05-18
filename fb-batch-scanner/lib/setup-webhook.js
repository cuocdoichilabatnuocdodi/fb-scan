/**
 * Push extension's webhookConfig via chrome.storage.local at startup.
 * Pass the already-acquired `sw` from launchBrowser (don't re-fetch — MV3 SW may idle).
 * Hard timeout to avoid hanging the whole batch if SW unresponsive.
 */

const TIMEOUT_MS = 5000;

async function setupWebhookConfig(sw, { port, secret, logger }) {
  if (!sw) {
    logger.warn('webhook config setup skipped — no service worker reference');
    return;
  }

  const url = `http://localhost:${port}/webhook`;
  const useHeader = !!(secret && !secret.startsWith('CHANGE_ME'));
  const desired = {
    url,
    authMode: useHeader ? 'header' : 'none',
    headerName: useHeader ? 'X-Secret' : '',
    headerValue: useHeader ? secret : '',
    tokenValue: '',
  };

  const evalPromise = sw.evaluate(async (cfg) => {
    const { webhookConfig: cur = {} } = await chrome.storage.local.get(['webhookConfig']);
    const same = cur.url === cfg.url
      && cur.authMode === cfg.authMode
      && cur.headerName === cfg.headerName
      && cur.headerValue === cfg.headerValue;
    if (same) return { changed: false };
    await chrome.storage.local.set({ webhookConfig: cfg });
    return { changed: true };
  }, desired);

  const timeoutPromise = new Promise((_, rej) =>
    setTimeout(() => rej(new Error(`timeout ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
  );

  try {
    const r = await Promise.race([evalPromise, timeoutPromise]);
    if (r.changed) {
      logger.info(`webhook config synced → ${url}${useHeader ? ' (Header X-Secret)' : ' (no auth)'}`);
    } else {
      logger.debug(`webhook config already correct → ${url}`);
    }
  } catch (e) {
    logger.warn(`webhook config sync failed (${e.message}) — extension may need manual config in Webhook Settings`);
  }
}

module.exports = { setupWebhookConfig };
