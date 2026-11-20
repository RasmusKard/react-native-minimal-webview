// Fails when the root, which the unit tests run on, and example/, which the on-device suites run on, resolve Expo, React
// or React Native to different versions.
// Run: node .github/scripts/check-expo-set.mts (npm run check runs it).
import { readFileSync } from 'node:fs';

const [root, example] = ['package-lock.json', 'example/package-lock.json'].map((lock) => {
  const { packages } = JSON.parse(
    readFileSync(new URL(`../../${lock}`, import.meta.url), 'utf8')
  ) as {
    packages: Record<string, { version: string }>;
  };
  return ['expo', 'react', 'react-native'].map(
    (name) => `${name}@${packages[`node_modules/${name}`].version}`
  );
});
if (root.join() !== example.join()) {
  console.error(
    `The root resolves ${root.join(', ')} and example/ ${example.join(', ')}: see .github/CONTRIBUTING.md`
  );
  process.exit(1);
}
