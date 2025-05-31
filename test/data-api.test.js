import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHandler, isAllowedPath } from '../server/data-api.js';

test('isAllowedPath accepts the app layout only', () => {
  for (const p of ['settings.json', 'templates/abc.json', 'extractions/x-1.json', 'files/abc.pdf']) assert.ok(isAllowedPath(p), p);
  for (const p of ['../x.json', 'files/../../etc/passwd', 'templates/a/b.json', '/settings.json', 'other/x.json', 'templates/x.txt', 'files/..', 'files/.', ''])
    assert.ok(!isAllowedPath(p), p);
});

test('file API round-trip in a temp data dir', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fe-data-'));
  const server = http.createServer((req, res) => createHandler(dir)(req, res, () => { res.statusCode = 418; res.end(); }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/__data`;
  const H = { 'X-Data-Api': '1' };

  assert.equal((await fetch(`${base}/ping`)).status, 403, 'header required');
  assert.equal((await fetch(`${base}/file/templates/a.json`, { headers: H })).status, 404);
  assert.equal((await fetch(`${base}/file/templates/a.json`, { method: 'PUT', headers: H, body: '{"x":1}' })).status, 204);
  assert.equal(await fs.readFile(path.join(dir, 'templates/a.json'), 'utf8'), '{"x":1}');
  assert.equal(await (await fetch(`${base}/file/templates/a.json`, { headers: H })).text(), '{"x":1}');
  await fetch(`${base}/file/settings.json`, { method: 'PUT', headers: H, body: '{}' });
  assert.deepEqual(await (await fetch(`${base}/list?dir=templates`, { headers: H })).json(), ['a.json']);
  assert.deepEqual((await (await fetch(`${base}/all`, { headers: H })).json()).sort(), ['settings.json', 'templates/a.json']);
  assert.equal((await fetch(`${base}/file/..%2F..%2Fescape.json`, { method: 'PUT', headers: H, body: 'x' })).status, 400);
  assert.equal((await fetch(`${base}/file/templates/a.json`, { method: 'DELETE', headers: H })).status, 204);
  assert.deepEqual(await (await fetch(`${base}/list?dir=templates`, { headers: H })).json(), []);
  assert.equal((await fetch('http://127.0.0.1:' + server.address().port + '/other')).status, 418, 'other routes pass through');
});
