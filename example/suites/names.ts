// The suites' names, apart from the suites: `maestro/run.sh` reads this file with Node, which can't load the suites.

/** What a full run runs, in run order. */
export const SUITE_NAMES = [
  'urlTracking',
  'navigation',
  'reissue',
  'bridge',
  'bfcache',
  'injection',
  'errors',
  'crash',
  'mountSettings',
  'settings',
  'upload',
  'downloads',
  'permissions',
  'fullscreen',
  'ua',
  'dialogs',
  'sampleExtension',
  'extensions',
  'ptr',
  'network',
  'sources',
  'refLoad',
  'shapes',
  'hostile',
] as const;
