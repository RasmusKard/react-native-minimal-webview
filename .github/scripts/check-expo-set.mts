// Fails when the root, which the unit tests run on, and example/, which the on-device suites run on, resolve Expo, React
// or React Native to different versions.
// Run: node .github/scripts/check-expo-set.mts (pnpm run check runs it).
import { readFileSync } from 'node:fs';

const lock = readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8');
const importers = lock.slice(lock.indexOf('\nimporters:'), lock.indexOf('\npackages:'));
const versions = new Map<string, string>();
let importer = '';
let dependency = '';
for (const line of importers.split('\n')) {
  const [, indent, key, value] = line.match(/^( *)'?(.+?)'?:\s*(.*)$/) ?? [];
  if (indent?.length === 2) importer = key;
  else if (indent?.length === 6) dependency = key;
  else if (indent?.length === 8 && key === 'version')
    versions.set(`${importer} ${dependency}`, value);
}
const [root, example] = ['.', 'example'].map((name) =>
  ['expo', 'react', 'react-native'].map((dep) => `${dep}@${versions.get(`${name} ${dep}`)}`)
);
if (root.join() !== example.join()) {
  console.error(
    `The root resolves ${root.join(', ')} and example/ ${example.join(', ')}: see .github/CONTRIBUTING.md`
  );
  process.exit(1);
}
