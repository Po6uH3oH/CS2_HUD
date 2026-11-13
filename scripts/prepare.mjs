import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const hash = createHash('sha256');
function visit(path) {
  if (!existsSync(path)) return;
  const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) visit(child);
    else { hash.update(relative(root, child)); hash.update(readFileSync(child)); }
  }
}
for (const dir of ['apps/web', 'packages']) visit(resolve(root, dir));
for (const name of ['package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.json']) hash.update(readFileSync(resolve(root, name)));
const fingerprint = hash.digest('hex'), marker = resolve(root, '.runtime/build.sha256');
const web = resolve(root, 'dist/web');
const ready = existsSync(resolve(web, 'index.html')) && existsSync(resolve(web, 'assets')) &&
  [...readFileSync(resolve(web, 'index.html'), 'utf8').matchAll(/(?:src|href)="\/(assets\/[^"?]+)"/g)].every(m => existsSync(resolve(web, m[1])));
if (!ready || !existsSync(marker) || readFileSync(marker, 'utf8').trim() !== fingerprint) {
  for (const args of [['node_modules/typescript/bin/tsc', '--noEmit'], ['node_modules/vite/bin/vite.js', 'build']]) {
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  mkdirSync(resolve(root, '.runtime'), { recursive: true }); writeFileSync(marker, fingerprint);
}
console.log('HUD build is ready');
