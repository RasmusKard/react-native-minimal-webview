import { Platform } from 'react-native';

import {
  fresh,
  idle,
  openPage,
  pageLog,
  sleep,
  tapPoint,
  waitFor,
  waitForLoad,
  happens,
  poll,
} from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';

export async function fullscreen(h: Harness, r: Reporter) {
  if (Platform.OS !== 'android') {
    await openPage(h, fresh(h, '/media.html'));
    const lines = await pageLog(h, async () =>
      r.drive({ action: 'tap', point: await tapPoint(h, 'play') })
    );
    await sleep(1000);
    const remounted = await happens(waitForLoad(h, () => h.remount()));
    r.check(
      'an unmount while a video is in fullscreen leaves the app running',
      lines?.includes('video fullscreen') === true && remounted,
      { lines, remounted }
    );
    return;
  }
  await openPage(h, fresh(h, '/media.html'));
  h.events.fullscreen.length = 0;
  r.drive({ action: 'tap', point: await tapPoint(h, 'fullscreen') });
  r.check(
    'entering fullscreen is reported',
    await happens(waitFor(h, () => h.events.fullscreen.includes(true), 10000)),
    h.events.fullscreen
  );
  // BACK on the root screen would background the app: only send it when fullscreen is on.
  if (!h.events.fullscreen.includes(true)) {
    return;
  }
  r.drive({ action: 'back' });
  r.check(
    'back leaves fullscreen',
    await happens(waitFor(h, () => h.events.fullscreen.at(-1) === false, 10000)),
    h.events.fullscreen
  );
  r.check('the page is still there', h.state().url.includes('/media.html'), h.state());

  h.setProps({ onFullscreenChange: undefined });
  await sleep(300);
  const active = async () =>
    (await h.ref.current?.evaluate('document.fullscreenElement !== null')) === true;
  const becomes = async (want: boolean) => !!(await poll(async () => (await active()) === want));
  const lines = await pageLog(h, async () =>
    r.drive({ action: 'tap', point: await tapPoint(h, 'fullscreen') })
  );
  const entered = await becomes(true);
  r.check('fullscreen works without onFullscreenChange', entered, lines);
  if (entered) {
    r.drive({ action: 'back' });
    r.check('back leaves it', await becomes(false));
  }

  h.setProps({});
  await sleep(300);
  r.drive({ action: 'tap', point: await tapPoint(h, 'fullscreen') });
  await waitFor(h, () => h.events.fullscreen.at(-1) === true, 10000);
  await waitForLoad(
    h,
    async () => {
      const gone = h.events.gone.length;
      r.drive({ action: 'kill' }, 'in fullscreen');
      await waitFor(h, () => h.events.gone.length > gone, 15000);
      r.check(
        'a crash leaves fullscreen',
        await happens(waitFor(h, () => h.events.fullscreen.at(-1) === false, 5000)),
        h.events.fullscreen
      );
    },
    (s) => s.url.includes('/media.html') && idle(s)
  );
}
