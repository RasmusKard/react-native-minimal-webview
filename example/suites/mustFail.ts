import { until } from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';

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
