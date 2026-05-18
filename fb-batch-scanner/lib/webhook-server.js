const http = require('http');
const { EventEmitter } = require('events');

function startServer({ port, secret, logger }) {
  const emitter = new EventEmitter();
  const seenIds = new Set();

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end('method not allowed');
      return;
    }

    if (secret && req.headers['x-secret'] !== secret) {
      logger.warn('webhook: unauthorized request', { from: req.socket.remoteAddress });
      res.writeHead(401).end('unauthorized');
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);

        if (payload.requestId && seenIds.has(payload.requestId)) {
          logger.debug('webhook: duplicate ignored', { requestId: payload.requestId });
          res.writeHead(200).end('dup');
          return;
        }
        if (payload.requestId) seenIds.add(payload.requestId);

        logger.debug(`webhook: ${payload.event}`, {
          totalPosts: payload.data?.totalPosts,
          collectionId: payload.data?.collectionId,
        });

        emitter.emit('event', payload);
        emitter.emit(payload.event, payload);

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        logger.error('webhook: bad payload', { err: e.message });
        res.writeHead(400).end('bad json');
      }
    });
  });

  return {
    emitter,
    start() {
      return new Promise((resolve) => {
        server.listen(port, () => {
          logger.info(`webhook server listening on :${port}`);
          resolve();
        });
      });
    },
    stop() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { startServer };
