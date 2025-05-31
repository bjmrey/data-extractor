// Vite plugin: a tiny file API so the app can keep its flat files in <project root>/data.
// It runs on `npm run dev` and `npm run preview` (not in a static build hosted elsewhere).
//
//   GET    /__data/ping              -> { ok: true }
//   GET    /__data/list?dir=<dir>    -> ["<name>", ...]  (files directly in data/<dir>)
//   GET    /__data/all               -> ["<path>", ...]  (every file, relative to data/)
//   GET    /__data/file/<path>       -> file bytes, 404 if missing
//   PUT    /__data/file/<path>       -> write the request body to the file
//   DELETE /__data/file/<path>       -> delete the file
//
// Only the app's own layout is accepted (settings.json, templates|destinations|extractions/*.json,
// files/*), so a request can never touch anything outside data/.
import fs from 'node:fs/promises';
import path from 'node:path';

const PREFIX = '/__data';
const ALLOWED = /^(settings\.json|(templates|destinations|extractions)\/[\w.-]+\.json|files\/[\w.-]+)$/;
const DIRS = new Set(['templates', 'destinations', 'extractions', 'files']);
const MAX_BODY = 200 * 1024 * 1024; // 200 MB per file

const TYPES = { '.json': 'application/json', '.pdf': 'application/pdf', '.csv': 'text/csv', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

export function isAllowedPath(p) {
  return typeof p === 'string' && ALLOWED.test(p) && !p.split('/').some((s) => s === '.' || s === '..');
}

function send(res, status, body, type = 'application/json') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('File too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function listFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export function createHandler(dataDir) {
  return async function handle(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + '/')) return next();
    // Custom header required: a cross-site page cannot send it without a CORS preflight, which we never approve.
    if (req.headers['x-data-api'] !== '1') return send(res, 403, { error: 'Missing X-Data-Api header' });
    const route = url.pathname.slice(PREFIX.length);
    try {
      if (req.method === 'GET' && route === '/ping') return send(res, 200, { ok: true, dir: 'data' });

      if (req.method === 'GET' && route === '/list') {
        const dir = url.searchParams.get('dir') || '';
        if (!DIRS.has(dir)) return send(res, 400, { error: 'Unknown directory' });
        return send(res, 200, await listFiles(path.join(dataDir, dir)));
      }

      if (req.method === 'GET' && route === '/all') {
        const out = (await listFiles(dataDir)).filter((n) => n === 'settings.json');
        for (const d of DIRS) for (const n of await listFiles(path.join(dataDir, d))) out.push(`${d}/${n}`);
        return send(res, 200, out.filter(isAllowedPath));
      }

      if (route.startsWith('/file/')) {
        const rel = decodeURIComponent(route.slice('/file/'.length));
        if (!isAllowedPath(rel)) return send(res, 400, { error: 'Invalid path' });
        const abs = path.join(dataDir, rel);

        if (req.method === 'GET') {
          try {
            return send(res, 200, await fs.readFile(abs), TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream');
          } catch (e) {
            if (e.code === 'ENOENT') return send(res, 404, { error: 'Not found' });
            throw e;
          }
        }
        if (req.method === 'PUT') {
          const body = await readBody(req);
          await fs.mkdir(path.dirname(abs), { recursive: true });
          const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
          await fs.writeFile(tmp, body);
          await fs.rename(tmp, abs); // atomic replace: a crash never leaves a half-written file
          return send(res, 204, '');
        }
        if (req.method === 'DELETE') {
          await fs.rm(abs, { force: true });
          return send(res, 204, '');
        }
      }
      return send(res, 404, { error: 'Unknown route' });
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
  };
}

export default function dataApi({ dir = 'data' } = {}) {
  let handler;
  return {
    name: 'financial-extractor-data-api',
    configResolved(config) {
      handler = createHandler(path.resolve(config.root, dir));
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => handler(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => handler(req, res, next));
    },
  };
}
