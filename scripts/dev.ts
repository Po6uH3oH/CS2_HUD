import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'apps/backend/index.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], { stdio: 'inherit' }),
];
let ending = false;
function stop(code = 0) { if (ending) return; ending = true; for (const child of children) child.kill(); setTimeout(() => process.exit(code), 200); }
for (const child of children) { child.on('error', e => { console.error(e.message); stop(1); }); child.on('exit', code => stop(code ?? 0)); }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
