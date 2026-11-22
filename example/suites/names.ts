// What `maestro/run.sh` reads with Node, which can't load the suites: the suites' names and a suite's time limit.

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

/** How long a suite may run before the runner fails it. The driver waits a little longer for its verdict. */
export const SUITE_MS = 270_000;
