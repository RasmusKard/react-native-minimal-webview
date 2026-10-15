const { defineConfig } = require('eslint/config');
const universe = require('eslint-config-universe/flat/native');
const universeWeb = require('eslint-config-universe/flat/web');

module.exports = defineConfig([
  { ignores: ['build'] },
  ...universe,
  ...universeWeb,
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
