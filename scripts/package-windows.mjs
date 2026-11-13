import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the Windows x64 release on Windows x64.');
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const config = JSON.parse(readFileSync(join(root, 'config/runtime.json'), 'utf8'));
const runtimeDir = join(root, '.runtime', `node-v${config.nodeVersion}-win-x64`);
const node = join(runtimeDir, 'node.exe');
const pnpm = join(root, '.runtime/tools/node_modules/pnpm/bin/pnpm.cjs');
if (!existsSync(node) || !existsSync(pnpm)) throw new Error('Run scripts/bootstrap.ps1 -Mode setup first.');
function run(exe, args, cwd = root) {
  const result = spawnSync(exe, args, { cwd, stdio: 'inherit', windowsHide: true, env: { ...process.env, PATH: `${runtimeDir};${process.env.PATH}` } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build command failed (${result.status}): ${args[0]}`);
}
run(node, ['scripts/check-runtime.mjs']);
run(node, ['scripts/prepare.mjs']);
run(node, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json']);
const output = join(root, 'release'); mkdirSync(output, { recursive: true });
const staging = mkdtempSync(join(output, '.stage-'));
const folderName = `CS2-HUD-${pkg.version}-win-x64`;
const portable = join(staging, folderName), appRoot = join(portable, 'resources/app');
mkdirSync(appRoot, { recursive: true });
cpSync(join(root, 'node_modules/electron/dist'), portable, { recursive: true, dereference: true });
renameSync(join(portable, 'electron.exe'), join(portable, 'CS2 HUD.exe'));
if (existsSync(join(portable, 'electron_wer.dll'))) renameSync(join(portable, 'electron_wer.dll'), join(portable, 'CS2 HUD_wer.dll'));
if (existsSync(join(portable, 'resources/default_app.asar'))) unlinkSync(join(portable, 'resources/default_app.asar'));
// Explicit allowlist: no working database, uploads, GSI logs, credentials or developer cache.
for (const [source, target] of [
  ['dist/server/apps', 'apps'], ['dist/server/packages', 'packages'], ['apps/desktop', 'apps/desktop'],
  ['dist/web', 'dist/web'], ['assets', 'assets'], ['docs', 'docs'], ['README.md', 'README.md'],
  ['pnpm-lock.yaml', 'pnpm-lock.yaml'], ['pnpm-workspace.yaml', 'pnpm-workspace.yaml'],
  ['config/runtime.json', 'config/runtime.json'], ['scripts/check-runtime.mjs', 'scripts/check-runtime.mjs'],
  ['scripts/start-browser.mjs', 'scripts/start-browser.mjs'],
]) {
  mkdirSync(resolve(appRoot, target, '..'), { recursive: true });
  cpSync(join(root, source), join(appRoot, target), { recursive: true, dereference: true });
}
writeFileSync(join(appRoot, 'package.json'), JSON.stringify({ ...pkg, main: 'apps/desktop/main.cjs' }, null, 2));
writeFileSync(join(appRoot, 'release.json'), JSON.stringify({ version: pkg.version, node: config.nodeVersion, platform: 'win32-x64' }, null, 2));
mkdirSync(join(appRoot, 'runtime'), { recursive: true });
cpSync(join(runtimeDir, 'node.exe'), join(appRoot, 'runtime/node.exe'));
cpSync(join(runtimeDir, 'LICENSE'), join(appRoot, 'runtime/LICENSE-Node.txt'));
run(node, [pnpm, 'install', '--prod', '--frozen-lockfile', '--config.node-linker=hoisted'], appRoot);
run(join(appRoot, 'runtime/node.exe'), ['scripts/check-runtime.mjs', '--production'], appRoot);
writeFileSync(join(portable, 'START_OBS.bat'), '@echo off\r\ncd /d "%~dp0resources\\app"\r\n"runtime\\node.exe" "scripts\\start-browser.mjs"\r\nif errorlevel 1 pause\r\n');
writeFileSync(join(portable, 'READ-ME-FIRST.md'), readFileSync(join(root, 'docs/first-run.md'), 'utf8').replace('(team-assignment.md)', '(resources/app/docs/team-assignment.md)'));
// Validate the assembled app before distributing it, including native sharp and SQLite.
run(node, [join(root, 'scripts/smoke-release.mjs'), portable]);
const zip = join(output, `${folderName}.zip`);
if (existsSync(zip)) unlinkSync(zip);
run('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/zip-release.ps1'), '-Source', portable, '-Destination', zip]);
writeFileSync(`${zip}.sha256`, `${createHash('sha256').update(readFileSync(zip)).digest('hex')}  ${folderName}.zip\n`);
console.log(`Release ready: ${zip}`);
