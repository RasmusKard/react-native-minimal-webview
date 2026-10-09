/// <reference types="node" />
// Fails if a packed build/**/*.js or .d.ts file imports a relative path that the package leaves out (a `files`
// negation in package.json that drops too much). Run after `npm run build`: node internal/check-pack.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const pack = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' });
const [{ files }] = /** @type {[{ files: { path: string }[] }]} */ (JSON.parse(pack));
const packed = new Set(files.map((f) => f.path));
const missing = [];
for (const file of packed) {
  const ext = file.endsWith('.d.ts') ? '.d.ts' : file.endsWith('.js') ? '.js' : null;
  if (!file.startsWith('build/') || !ext) continue;
  for (const [, spec] of readFileSync(file, 'utf8').matchAll(/(?:from|import\(?)\s*['"](\.{1,2}\/[^'"]*)['"]/g)) {
    const base = posix.join(posix.dirname(file), spec);
    if (![base, base + ext, `${base}/index${ext}`].some((p) => packed.has(p))) missing.push(`${file} -> ${spec}`);
  }
}
if (missing.length) throw new Error(`Packed files import paths missing from the package:\n${missing.join('\n')}`);
console.log(`check-pack: relative imports in ${packed.size} packed files all resolve`);
