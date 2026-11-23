// Fails when a lockfile lists Linux-only packages but none of them keeps its libc field. npm 10 drops the field
// whenever it writes a lockfile, and npm 11 does not add it back, so a Linux install then fetches the glibc and the
// musl build of each native package.
// Run: node .github/scripts/check-lockfile-libc.mts [--fix] (npm run check runs it). --fix has npm 11 resolve the
// Linux-only entries again, which writes the field back.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type Lock = { packages: Record<string, { os?: string[]; libc?: string[] }> };

const fix = process.argv.includes('--fix');
const stripped: string[] = [];
for (const lockfile of ['package-lock.json', 'example/package-lock.json']) {
  const path = fileURLToPath(new URL(`../../${lockfile}`, import.meta.url));
  const lock = JSON.parse(readFileSync(path, 'utf8')) as Lock;
  const linux = Object.keys(lock.packages).filter((key) =>
    lock.packages[key].os?.includes('linux')
  );
  if (linux.length === 0 || linux.some((key) => lock.packages[key].libc)) continue;
  if (!fix) {
    stripped.push(lockfile);
    continue;
  }
  for (const key of linux) delete lock.packages[key];
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
  execFileSync('npx', ['-y', 'npm@11', 'install', '--package-lock-only', '--ignore-scripts'], {
    cwd: dirname(path),
    stdio: 'inherit',
  });
}
if (stripped.length) {
  console.error(
    `${stripped.join(' and ')} lost the libc fields npm 10 strips: run node .github/scripts/check-lockfile-libc.mts --fix`
  );
  process.exit(1);
}
