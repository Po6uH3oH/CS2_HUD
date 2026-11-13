import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { runtimePaths, serverAvailable } = require('../apps/desktop/runtime.cjs');

test('portable runtime uses bundled Node and stable writable user data; source keeps its own data', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-paths-'));
  try {
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config/runtime.json'), JSON.stringify({ nodeVersion: '24.22.3' }));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.2.0' }));
    const env = { LOCALAPPDATA: join(root, 'user'), HUD_NODE: 'explicit-dev-node.exe' };
    let paths = runtimePaths(root, env);
    assert.equal(paths.dataDir, join(root, 'data')); assert.equal(paths.node, 'explicit-dev-node.exe');
    assert.ok(paths.args.includes('--import'));
    writeFileSync(join(root, 'release.json'), '{}');
    paths = runtimePaths(root, env);
    assert.equal(paths.dataDir, join(root, 'user/CS2HUD'));
    assert.equal(paths.node, join(root, 'runtime/node.exe'));
    assert.deepEqual(paths.args, [join(root, 'apps/backend/index.js')]);
    assert.equal(runtimePaths(root, { ...env, DATA_DIR: join(root, 'isolated') }).dataDir, join(root, 'isolated'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('launcher reuses only the same installation and version, rejecting occupied ports clearly', async () => {
  let response: object = { ok: true, application: 'cs2-hud', version: '0.2.0', installationId: 'current' };
  const server = createServer((_request, reply) => { reply.setHeader('Content-Type', 'application/json'); reply.end(JSON.stringify(response)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const runtime = { version: '0.2.0', installationId: 'current' };
  try {
    assert.equal(await serverAvailable(origin, runtime), true);
    response = { ok: true, mode: 'live' };
    await assert.rejects(serverAvailable(origin, runtime), /занят/);
    response = { ok: true, application: 'cs2-hud', version: '0.1.0', installationId: 'current' };
    await assert.rejects(serverAvailable(origin, runtime), /старой/);
    response = { ok: true, application: 'cs2-hud', version: '0.2.0', installationId: 'different' };
    await assert.rejects(serverAvailable(origin, runtime), /другой/);
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  assert.equal(await serverAvailable(origin, runtime), false);
});

test('dependency probe cannot borrow node_modules from a parent checkout', () => {
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(resolve('artifacts/startup-probe-'));
  try {
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    cpSync('scripts/check-runtime.mjs', join(root, 'scripts/check-runtime.mjs'));
    const result = spawnSync(process.execPath, ['scripts/check-runtime.mjs', '--production'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing local dependency/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
