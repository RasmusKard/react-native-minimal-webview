import { Platform } from 'react-native';

import {
  fresh,
  idle,
  openPage,
  pageLog,
  sleep,
  tapPoint,
  until,
  waitFor,
  waitForLoad,
} from '../harness/helpers';
import { reporter, type Harness } from '../harness/runner';

/**
 * Android fullscreen: the page's fullscreen view shows, back leaves it. iOS: an unmount while a video is in fullscreen.
 * The driver taps and presses back.
 */
export async function fullscreen(h: Harness) {
  const r = reporter('fullscreen');
  if (Platform.OS !== 'android') {
    // WebKit shows the video fullscreen itself, as an iPhone plays no video inline by default.
    await openPage(h, fresh(h, '/media.html'));
    const lines = await pageLog(h, async () => r.info('TAP', await tapPoint(h, 'play')));
    await sleep(1000); // the presentation
    const remounted = await waitForLoad(h, () => h.remount());
    r.check(
      'an unmount while a video is in fullscreen leaves the app running',
      lines?.includes('video fullscreen') === true && remounted,
      { lines, remounted }
    );
    r.done();
    return;
  }
  await openPage(h, fresh(h, '/media.html'));
  h.events.fullscreen.length = 0;
  r.info('TAP', await tapPoint(h, 'fullscreen'));
  r.check(
    'entering fullscreen is reported',
    await waitFor(h, () => h.events.fullscreen.includes(true), 10000),
    h.events.fullscreen
  );
  // BACK on the root screen would background the app: only send it when fullscreen is on.
  if (!h.events.fullscreen.includes(true)) {
    r.done();
    return;
  }
  r.info('BACK', 'leave');
  r.check(
    'back leaves fullscreen',
    await waitFor(h, () => h.events.fullscreen.at(-1) === false, 10000),
    h.events.fullscreen
  );
  r.check('the page is still there', h.state().url.includes('/media.html'), h.state());

  // Fullscreen works without onFullscreenChange too. Nothing is reported then, so the page's fullscreenElement tells.
  h.setProps({ onFullscreenChange: undefined });
  await sleep(300);
  const active = async () =>
    (await h.ref.current?.evaluate('document.fullscreenElement !== null')) === true;
  const becomes = async (want: boolean) => !!(await until(async () => (await active()) === want));
  const lines = await pageLog(h, async () => r.info('TAP', await tapPoint(h, 'fullscreen')));
  const entered = await becomes(true);
  r.check('fullscreen works without onFullscreenChange', entered, lines);
  if (entered) {
    r.info('BACK', 'leave');
    r.check('back leaves it', await becomes(false));
  }

  // A renderer crash ends the Document: the fullscreen view, the back handler and the hidden bars go without
  // Chromium's onHideCustomView, which a dead renderer never sends. Last, because recovery replaces the WebView.
  h.setProps({});
  await sleep(300);
  r.info('TAP', await tapPoint(h, 'fullscreen'));
  await waitFor(h, () => h.events.fullscreen.at(-1) === true, 10000);
  // The kill in fullscreen, then the recovery load.
  await waitForLoad(
    h,
    async () => {
      const gone = h.events.gone.length;
      r.info('KILL', 'in fullscreen');
      await waitFor(h, () => h.events.gone.length > gone, 15000);
      r.check(
        'a crash leaves fullscreen',
        await waitFor(h, () => h.events.fullscreen.at(-1) === false, 5000),
        h.events.fullscreen
      );
    },
    (s) => s.url.includes('/media.html') && idle(s)
  );
  r.done();
}
