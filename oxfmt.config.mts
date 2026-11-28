import { defineConfig } from 'oxfmt';

export default defineConfig({
  printWidth: 100,
  singleQuote: true,
  bracketSameLine: true,
  trailingComma: 'es5',
  sortPackageJson: false,
  ignorePatterns: [
    'src/bridge/pageClient.generated.ts',
    'src/platform.generated.ts',
    'src/types.defaults.ts',
    '.github/scripts/platform-headers/',
    'package-lock.json',
    '.github/.release-please-manifest.json',
    'build/',
    'extensions/build/',
    'eslint.config.cjs',
    '.github/workflows/',
    'example/test-pages/',
    '*.md',
    '!/README.md',
    '!/extensions/README.md',
    '!/guides/*.md',
    'example/ios/',
    'example/android/',
  ],
});
