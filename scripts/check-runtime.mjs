import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';
const require = createRequire(new URL('../package.json', import.meta.url));
const modules = fileURLToPath(new URL('../node_modules/', import.meta.url));
function localPackage(name) {
  const location = relative(resolve(modules), require.resolve(name));
  if (location.startsWith('..') || isAbsolute(location)) throw new Error(`Missing local dependency: ${name}`);
}
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24+ required');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:'); db.exec('SELECT 1'); db.close();
  for (const name of ['express', 'ws', 'zod', 'fast-xml-parser', 'sharp']) { localPackage(name); require(name); }
  const sharp = require('sharp');
  await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer();
  if (!process.argv.includes('--production')) {
    for (const name of ['typescript', 'vite', 'tsx', 'react', 'react-dom', 'lucide-react', 'electron']) localPackage(name);
    if (!existsSync(require('electron'))) throw new Error('Electron executable missing');
  }
  console.log('Runtime and native dependencies OK');
} catch (error) { console.error(error.message); process.exitCode = 1; }
