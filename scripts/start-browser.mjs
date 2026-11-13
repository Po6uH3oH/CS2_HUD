import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { runtimePaths, serverAvailable } = require('../apps/desktop/runtime.cjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = runtimePaths(root);
const port = Number(process.env.PORT || 3190);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid HUD port');
const origin = `http://127.0.0.1:${port}`;
const openBrowser = () => {
  if (process.env.HUD_NO_BROWSER === '1') return;
  const opener = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', `${origin}/admin`], { windowsHide: true, stdio: 'ignore' });
  opener.on('error', () => console.log(`Open ${origin}/admin in your browser.`));
  opener.unref();
};
if (await serverAvailable(origin, runtime)) { openBrowser(); }
else {
  const server = spawn(runtime.node, runtime.args, { cwd: root, env: { ...process.env, DATA_DIR: runtime.dataDir, PORT: String(port) }, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
  let failure;
  server.on('error', error => { failure = error; });
  server.on('exit', code => { process.exitCode = code ?? 1; });
  const stop = () => { if (server.exitCode === null) server.kill(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('exit', stop);
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (failure) throw failure;
      if (server.exitCode !== null) throw new Error('HUD server stopped before startup. See the message above.');
      if (await serverAvailable(origin, runtime)) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('HUD did not start within 20 seconds.');
    console.log(`HUD is ready: ${origin}/admin`); openBrowser();
  } catch (error) { stop(); console.error(error.message); process.exitCode = 1; }
}
