// CI only (not per edit). Run: npm run lint:ci
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  { ignores: ['build/**', 'example/**', 'ios/**', 'android/**', '**/*.d.ts'] },
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
    plugins: { sonarjs },
    rules: { 'sonarjs/no-trivial-assertions': 'error' },
  },
];
