const path = require('node:path');
const os = require('node:os');
const { existsSync, readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

function runtimePaths(root, env = process.env) {
  const packaged = existsSync(path.join(root, 'release.json'));
  const dataDir = path.resolve(env.DATA_DIR || (packaged ? path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'CS2HUD') : path.join(root, 'data')));
  const config = JSON.parse(readFileSync(path.join(root, 'config/runtime.json'), 'utf8'));
  const localNode = path.join(root, '.runtime', `node-v${config.nodeVersion}-win-x64/node.exe`);
  const node = packaged ? path.join(root, 'runtime/node.exe') : env.HUD_NODE || (existsSync(localNode) ? localNode : 'node');
  const args = packaged ? [path.join(root, 'apps/backend/index.js')] : ['--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href, path.join(root, 'apps/backend/index.ts')];
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const installationId = createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 16);
  return { packaged, dataDir, node, args, version, installationId };
}

async function serverAvailable(origin, runtime) {
  let response;
  try { response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) }); }
  catch { return false; }
  let value;
  try { value = await response.json(); } catch { /* Occupied by a different local application. */ }
  if (!response.ok || value?.application !== 'cs2-hud' || value.version !== runtime.version || value.installationId !== runtime.installationId) {
    throw new Error(`Порт ${new URL(origin).port} занят другой или старой копией приложения. Закройте её через «Завершить HUD» и повторите запуск.`);
  }
  return value.ok === true;
}
module.exports = { runtimePaths, serverAvailable };
