import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const portable = resolve(process.argv[2]);
const dataDir = mkdtempSync(join(tmpdir(), 'cs2-hud-release-'));
const socket = createServer();
await new Promise(resolveReady => socket.listen(0, '127.0.0.1', resolveReady));
const port = socket.address().port; await new Promise(resolveClose => socket.close(resolveClose));
const appRoot = join(portable, 'resources/app');
const node = join(appRoot, 'runtime/node.exe');
assert.ok(existsSync(node));
assert.ok(!existsSync(join(appRoot, 'data')));
assert.ok(!existsSync(join(appRoot, 'node_modules/electron')), 'Release must not depend on a dev Electron installation');
const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir, HUD_NO_BROWSER: '1', HUD_NODE: '', NODE_PATH: '', NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: '', PATH: `${process.env.SystemRoot}\System32;${process.env.SystemRoot}` };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
let child;
async function stop() {
  if (child && child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)); }
}
try {
  child = spawn(node, ['apps/backend/index.js'], { cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = ''; child.stdout.on('data', d => { logs += d; }); child.stderr.on('data', d => { logs += d; });
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Packaged backend exited: ${logs}`);
    try { const r = await fetch(`${origin}/api/health`); ready = r.ok && (await r.json()).application === 'cs2-hud'; } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, logs);
  assert.match(await (await fetch(`${origin}/admin`)).text(), /assets\/index/);
  const state = await (await fetch(`${origin}/api/state`)).json();
  assert.equal(state.state.mode, 'live'); assert.equal(state.state.players.length, 0);
  const library = await (await fetch(`${origin}/api/library?kind=team`)).json();
  assert.ok(library.length >= 10);
  assert.equal((await fetch(`${origin}${library[0].data.logo}`)).status, 200);
  assert.equal((await fetch(`${origin}/assets/icons/ui/explosion.gif`)).status, 200);
  assert.equal((await fetch(`${origin}${state.settings.radarMaps[0].layers[0].image}`)).status, 200);
  assert.match(await (await fetch(`${origin}/api/gsi-config`)).text(), new RegExp(`127.0.0.1:${port}/api/gsi`));
  await stop();
  child = spawn(join(portable, 'CS2 HUD.exe'), ['--smoke-test'], { cwd: portable, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let desktopLogs = ''; child.stdout.on('data', d => { desktopLogs += d; }); child.stderr.on('data', d => { desktopLogs += d; });
  const code = await new Promise((done, reject) => {
    const deadline = setTimeout(() => { child.kill(); reject(new Error('Packaged Electron startup timed out')); }, 45000);
    child.once('error', e => { clearTimeout(deadline); reject(e); });
    child.once('exit', c => { clearTimeout(deadline); done(c); });
  });
  assert.equal(code, 0, existsSync(join(dataDir, 'desktop-error.txt')) ? readFileSync(join(dataDir, 'desktop-error.txt'), 'utf8') : desktopLogs || 'Electron exited unsuccessfully');
  const report = JSON.parse(readFileSync(join(dataDir, 'desktop-smoke.json'), 'utf8'));
  assert.equal(report.packaged, true); assert.equal(report.startedServer, true);
  assert.equal(report.focusable, false); assert.equal(report.alwaysOnTop, true);
  console.log(`Packaged backend + Electron OK without system Node.js. Test data: ${dataDir}`);
} finally { await stop(); }
