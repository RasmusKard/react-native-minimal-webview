// CI only (not per edit): the few rules oxlint lacks. Run: eslint -c eslint.ci.config.mjs src
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import testingLibrary from 'eslint-plugin-testing-library';

export default [
  { ignores: ['build/**', 'example/**', 'ios/**', 'android/**', 'internal/**', '**/*.d.ts'] },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { sonarjs },
    rules: {
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/nested-control-flow': ['error', { maximumNestingLevel: 3 }],
      'sonarjs/no-identical-functions': 'error',
    },
  },
  {
    files: ['**/*.test.{ts,tsx,js,jsx}', '**/__tests__/**'],
    plugins: { sonarjs, 'testing-library': testingLibrary },
    rules: {
      'sonarjs/no-trivial-assertions': 'error',
      'testing-library/await-async-queries': 'error',
      'testing-library/await-async-utils': 'error',
      'testing-library/await-async-events': 'error',
      'testing-library/no-await-sync-queries': 'error',
      'testing-library/no-await-sync-events': 'error',
      'testing-library/no-debugging-utils': 'error',
      'testing-library/no-unnecessary-act': 'error',
      'testing-library/no-promise-in-fire-event': 'error',
      'testing-library/no-wait-for-side-effects': 'error',
    },
  },
];
