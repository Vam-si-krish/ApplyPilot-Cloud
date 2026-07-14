import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import httpProxy from 'http-proxy';

const here = path.dirname(fileURLToPath(import.meta.url));

function env(name, fallback = '') {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function safeEqual(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function serviceToken(req) {
  const bearer = req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  return req.get('apikey') || bearer;
}

function storageLocation(root, bucket, objectPath) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(bucket)) throw new Error('Invalid bucket');
  const bucketRoot = path.resolve(root, bucket);
  const target = path.resolve(bucketRoot, objectPath);
  if (target !== bucketRoot && !target.startsWith(`${bucketRoot}${path.sep}`)) {
    throw new Error('Invalid object path');
  }
  return target;
}

function signedToken(secret, bucket, objectPath, expiresAt) {
  const body = `${bucket}\n${objectPath}\n${expiresAt}`;
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${expiresAt}.${signature}`;
}

function validSignedToken(secret, bucket, objectPath, token) {
  const [expiresRaw, signature = ''] = String(token || '').split('.', 2);
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = signedToken(secret, bucket, objectPath, expiresAt).split('.')[1];
  return safeEqual(signature, expected);
}

function storageParams(req) {
  return { bucket: req.params[0], objectPath: req.params[1] };
}

export function createApp(options = {}) {
  const serviceKey = options.serviceKey || env('SERVICE_ROLE_KEY');
  const signingSecret = options.signingSecret || env('STORAGE_SIGNING_SECRET');
  const dataRoot = options.dataRoot || path.join(here, 'data');
  const restTarget = options.restTarget || env('REST_TARGET', 'http://127.0.0.1:8232');
  const workerTarget = options.workerTarget || process.env.WORKER_TARGET || 'http://127.0.0.1:8233';
  const corsOrigins = (options.corsOrigins || process.env.CORS_ORIGINS || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const proxy = httpProxy.createProxyServer({ changeOrigin: false });
  proxy.on('error', (_error, _req, res) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upstream service unavailable' }));
  });

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && corsOrigins.includes(origin)) {
      res.set('access-control-allow-origin', origin);
      res.set('vary', 'Origin');
      res.set('access-control-allow-headers', 'authorization, apikey, content-type, prefer, range');
      res.set('access-control-allow-methods', 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const router = express.Router();
  router.get('/health', async (_req, res) => {
    try {
      const upstream = await fetch(`${restTarget}/`, { signal: AbortSignal.timeout(3000) });
      res.status(upstream.ok ? 200 : 503).json({ ok: upstream.ok, databaseApi: upstream.ok });
    } catch {
      res.status(503).json({ ok: false, databaseApi: false });
    }
  });

  const requireServiceKey = (req, res, next) => {
    if (!safeEqual(serviceToken(req), serviceKey)) {
      return res.status(401).json({ message: 'Invalid backend service key' });
    }
    next();
  };

  router.use('/rest/v1', requireServiceKey, (req, res) => proxy.web(req, res, { target: restTarget }));
  router.use('/worker', (req, res) => proxy.web(req, res, { target: workerTarget }));

  router.post(
    /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/,
    requireServiceKey,
    express.json({ limit: '32kb' }),
    async (req, res) => {
      const { bucket, objectPath } = storageParams(req);
      try {
        await fs.access(storageLocation(dataRoot, bucket, objectPath));
        const expiresIn = Math.max(1, Math.min(Number(req.body?.expiresIn) || 60, 86400));
        const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
        const token = signedToken(signingSecret, bucket, objectPath, expiresAt);
        const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
        res.json({ signedURL: `/object/sign/${encodeURIComponent(bucket)}/${encodedPath}?token=${token}` });
      } catch {
        res.status(404).json({ message: 'Object not found', statusCode: '404' });
      }
    },
  );

  router.get(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/, async (req, res) => {
    const { bucket, objectPath } = storageParams(req);
    if (!validSignedToken(signingSecret, bucket, objectPath, req.query.token)) {
      return res.status(401).json({ message: 'Invalid or expired download token' });
    }
    try {
      const file = storageLocation(dataRoot, bucket, objectPath);
      const download = typeof req.query.download === 'string' ? path.basename(req.query.download) : '';
      if (download) res.attachment(download);
      else res.type(path.extname(file));
      res.sendFile(file);
    } catch {
      res.status(404).json({ message: 'Object not found' });
    }
  });

  router.post(
    /^\/storage\/v1\/object\/([^/]+)\/(.+)$/,
    requireServiceKey,
    express.raw({ type: () => true, limit: '50mb' }),
    async (req, res) => {
      const { bucket, objectPath } = storageParams(req);
      try {
        const file = storageLocation(dataRoot, bucket, objectPath);
        const exists = await fs.access(file).then(() => true, () => false);
        if (exists && req.get('x-upsert') !== 'true') {
          return res.status(409).json({ message: 'Object already exists', statusCode: '409' });
        }
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, req.body);
        res.json({ Key: `${bucket}/${objectPath}`, Id: crypto.randomUUID() });
      } catch (error) {
        res.status(400).json({ message: error.message, statusCode: '400' });
      }
    },
  );

  app.use('/jobpilot', router);
  app.use('/', router);
  return app;
}

export function startServer(options = {}) {
  const app = createApp(options);
  const port = Number(options.port || process.env.PORT || 8231);
  const server = http.createServer(app);
  server.listen(port, '127.0.0.1');
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = startServer();
  server.on('listening', () => console.log(`backend listening on 127.0.0.1:${server.address().port}`));
}
