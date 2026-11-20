import { until } from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';

/** Fails on purpose in each way a suite can: maestro/self-test.sh checks that a run reports every one. */
export async function mustFail(_: Harness, r: Reporter) {
  r.check('a check that passes', true);
  r.check('a check that fails', false, 'on purpose');
  r.skip('a skip', 'on purpose');
  r.cleanup(() => {
    throw new Error('on purpose');
  });
  await r.block('a block that throws', async () => {
    await until(() => false, 200);
  });
}
