import { defineConfig } from 'oxlint';
import native from 'oxlint-config-universe/native';
import typescriptAnalysis from 'oxlint-config-universe/typescript-analysis';

// Run: oxlint -c oxlint.config.mjs --type-aware <files>
export default defineConfig({
  extends: [native, typescriptAnalysis],
  ignorePatterns: ['build', 'example', 'ios', 'android', 'internal', '**/*.config.*'],
  rules: {
    // escape hatches
    'typescript/no-explicit-any': 'error',
    'typescript/ban-ts-comment': 'error',
    'typescript/no-unsafe-assignment': 'error',
    'typescript/no-unsafe-call': 'error',
    'typescript/no-unsafe-member-access': 'error',
    'typescript/no-unsafe-return': 'error',
    'typescript/no-unsafe-argument': 'error',
    'typescript/no-floating-promises': 'error',
    // over-engineering
    'typescript/no-extraneous-class': 'error',
    'no-useless-constructor': 'error',
    'no-empty': ['error', { allowEmptyCatch: false }],
    // BLOCK: depth 3, cyclomatic 15 (cognitive 15 is in eslint.ci.config.mjs)
    'max-depth': ['error', 3],
    complexity: ['error', 15],
    // React mistakes (oxlint-config-universe/native leaves these off or at warn, and .claude/check keeps errors only)
    'react/exhaustive-deps': 'error',
    'react/jsx-key': 'error',
    'react/no-unstable-nested-components': 'error',
    'react/no-deriving-state-in-effects': 'error',
    // WARN only
    'max-lines-per-function': ['warn', { max: 120, skipBlankLines: true, skipComments: true }],
    'max-params': ['warn', 6],
    // TypeScript checks this; fires on the generated empty src/MyModule.types.ts
    'import/export': 'off',
  },
  overrides: [
    {
      files: ['**/*.test.{ts,tsx,js,jsx}', '**/__tests__/**'],
      plugins: ['jest'],
      rules: {
        'jest/expect-expect': 'error',
        'jest/no-disabled-tests': 'error',
        'jest/no-focused-tests': 'error',
        'jest/no-conditional-expect': 'error',
        'jest/valid-expect': 'error',
      },
    },
  ],
});
