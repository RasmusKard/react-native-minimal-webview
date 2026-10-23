const { defineConfig } = require('eslint/config');
const universe = require('eslint-config-universe/flat/native');
const universeWeb = require('eslint-config-universe/flat/web');
const sonarjs = require('eslint-plugin-sonarjs');
const globals = require('globals');

// universe's TypeScript blocks match .ts and .tsx only; the .github/scripts are .mts.
const withMts = (configs) =>
  configs.map((c) => (c.files?.includes('**/*.ts') ? { ...c, files: [...c.files, '**/*.mts'] } : c));

module.exports = defineConfig([
  {
    ignores: [
      'build',
      '**/build',
      '.claude',
      'example/ios',
      'example/android',
      'node_modules',
      '**/node_modules',
    ],
  },
  ...withMts(universe),
  ...withMts(universeWeb),
  { rules: { 'no-void': 'off' } }, // `void promise` marks a fire-and-forget call
  {
    ignores: ['example/**'], // the suite runner and test pages server are long by design
    plugins: { sonarjs },
    rules: {
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/nested-control-flow': ['error', { maximumNestingLevel: 3 }],
      'sonarjs/no-identical-functions': 'error',
    },
  },
  {
    files: ['**/*.test.{ts,tsx,js,jsx}', '**/__tests__/**'],
    plugins: { sonarjs },
    rules: { 'sonarjs/no-trivial-assertions': 'error' },
  },
  {
    // Node scripts: Metro and Babel configs, the test pages server.
    files: ['example/*.js', 'example/test-pages/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Maestro runScript scripts: Maestro's globals (example/maestro/scripts/maestro.d.ts).
    files: ['example/maestro/scripts/*.js'],
    languageOptions: {
      globals: {
        http: 'readonly',
        output: 'writable',
        PLATFORM: 'readonly',
        DEVICE: 'readonly',
        SUITE: 'readonly',
        N: 'readonly',
      },
    },
  },
]);
