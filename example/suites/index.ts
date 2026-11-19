import { bfcache } from './bfcache';
import { bridge } from './bridge';
import { crash } from './crash';
import { dialogs } from './dialogs';
import { downloadsSuite } from './downloads';
import { errors } from './errors';
import { extensions } from './extensions';
import { fullscreen } from './fullscreen';
import { hostile } from './hostile';
import { urlTracking } from './urlTracking';
import { navigation } from './navigation';
import { reissue } from './reissue';
import { injection } from './injection';
import { mountSettings } from './mountSettings';
import { settings } from './settings';
import { upload } from './upload';
import { permissionsSuite } from './permissions';
import { ua } from './ua';
import { sampleExtension } from './sampleExtension';
import { ptr } from './ptr';
import { network } from './network';
import { perf, perfCold } from './perf';
import { sources } from './sources';
import { refLoad } from './refLoad';
import { shapes } from './shapes';
import { type Harness } from '../harness/runner';

/**
 * In run order: `maestro/run.sh` runs these keys when it is given no suites. A suite reports `skipped` on a platform it
 * doesn't apply to, leaves nothing behind that `reset()` doesn't undo, and needs no site but the test pages server.
 */
export const SUITES: Record<string, (h: Harness) => Promise<void>> = {
  urlTracking,
  navigation,
  reissue,
  bridge,
  bfcache,
  injection,
  errors,
  crash,
  mountSettings,
  settings,
  upload,
  downloads: downloadsSuite,
  permissions: permissionsSuite,
  fullscreen,
  ua,
  dialogs,
  sampleExtension,
  extensions,
  ptr,
  network,
  sources,
  refLoad,
  shapes,
  hostile,
};

/** Timings, run only when named (`maestro/run.sh <platform> <device> perfCold perf`): a full run leaves them out. */
export const ON_DEMAND: Record<string, (h: Harness) => Promise<void>> = { perf, perfCold };
