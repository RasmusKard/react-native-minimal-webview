/** Hygiene-only rules (no layering). Run: depcruise --config .dependency-cruiser.cjs src */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'no-orphans',
      severity: 'error',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|json)$', // dotfiles
          '[.]d[.]ts$',
          '(^|/)tsconfig[.]json$',
          '(^|/)[^/]+[.]config[.](?:js|cjs|mjs|ts)$',
          '[.](?:web|ios|android|native)[.][jt]sx?$', // Metro picks these by platform, nothing imports them
          '[.](?:test|spec)[.][jt]sx?$',
          '(^|/)__(?:tests|mocks)__/',
          '(^|/)index[.][jt]sx?$',
        ],
      },
      to: {},
    },
    { name: 'not-to-unresolvable', severity: 'error', from: {}, to: { couldNotResolve: true } },
    { name: 'no-non-package-json', severity: 'error', from: {}, to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: ['^node_modules', '^build', '^example'] },
  },
};
