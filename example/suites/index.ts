import { bfcache } from './bfcache';
import { bridge } from './bridge';
import { crash } from './crash';
import { dialogs } from './dialogs';
import { downloadsSuite } from './downloads';
import { errors } from './errors';
import { extensions } from './extensions';
import { fullscreen } from './fullscreen';
import { hostile } from './hostile';
import { injection } from './injection';
import { mountSettings } from './mountSettings';
import { mustFail } from './mustFail';
import { SUITE_NAMES } from './names';
import { navigation } from './navigation';
import { network } from './network';
import { perf, perfCold } from './perf';
import { permissionsSuite } from './permissions';
import { ptr } from './ptr';
import { refLoad } from './refLoad';
import { reissue } from './reissue';
import { sampleExtension } from './sampleExtension';
import { settings } from './settings';
import { shapes } from './shapes';
import { sources } from './sources';
import { ua } from './ua';
import { upload } from './upload';
import { urlTracking } from './urlTracking';
import { type Suite } from '../harness/runner';

/** Every name in `SUITE_NAMES` has its suite here, and the compiler checks it. */
export const SUITES: Record<(typeof SUITE_NAMES)[number], Suite> = {
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

/**
 * Run only when named, a full run leaves them out: the timings (`maestro/run.sh <platform> <device> perfCold perf`), and
 * the suite `maestro/self-test.sh` runs.
 */
export const ON_DEMAND: Record<string, Suite> = { perf, perfCold, mustFail };
