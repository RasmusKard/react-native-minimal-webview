import { Platform } from 'react-native';
import { seams } from 'sample-extension';

import {
  fresh,
  happens,
  openPage,
  pageLog,
  poll,
  sleep,
  touch,
  waitFor,
  waitForLoad,
} from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';

/**
 * alert, confirm and prompt reach the user and their answers reach the page, and on iOS a dialog goes with its WebView:
 * an unmount or a crash closes the one on screen. The driver presses the buttons.
 */
export async function dialogs(h: Harness, r: Reporter) {
  const open = (id: string) =>
    void h.ref.current?.evaluate(`setTimeout(() => document.getElementById('${id}').click(), 0)`);
  const up = async (id: string) => {
    await openPage(h, fresh(h, '/dialogs.html'));
    open(id);
    await sleep(1000); // the presentation
  };
  /** A dialog left on screen would take the tap. */
  const tapReaches = async () => {
    await openPage(h, fresh(h, '/dialogs.html'));
    return await pageLog(h, () => touch(h, r, 'tap'), 5000);
  };
  const unmountCloses = async (id: string) => {
    const remounted = await happens(waitForLoad(h, () => h.remount()));
    const lines = await tapReaches();
    r.check(
      `an unmount closes the ${id} on screen: a tap reaches the new page`,
      remounted && lines?.join() === 'tapped',
      { remounted, lines }
    );
  };
  // Android's WebView leaves its dialog on screen when it is destroyed, and one older than 149 then gets no touches
  // (https://crbug.com/504317449).
  if (Platform.OS === 'ios') {
    for (const id of ['alert', 'confirm', 'prompt']) {
      await up(id);
      await unmountCloses(id);
    }
    await up('alert');
    const gone = h.events.gone.length;
    const recovered = await happens(
      waitForLoad(h, async () => {
        r.drive({ action: 'kill' });
        await waitFor(h, () => h.events.gone.length > gone, 15000);
      })
    );
    const afterCrash = await tapReaches();
    r.check(
      'a crash while an alert is up closes it: a tap reaches the reloaded page',
      recovered && afterCrash?.join() === 'tapped',
      { recovered, afterCrash }
    );
  } else {
    // WebKit has no beforeunload dialog.
    await openPage(h, fresh(h, '/dialogs.html'));
    await pageLog(h, () => touch(h, r, 'beforeunload'), 5000);
    r.drive({ action: 'press', text: 'Stay.*' });
    void h.ref.current?.evaluate('setTimeout(() => location.reload(), 0)');
    const log = await poll(() => h.ref.current?.evaluate('window.testLog.join()'), 15000);
    r.check('beforeunload answered with Stay keeps the page', log === 'beforeunload armed', log);
    await h.ref.current?.evaluate('onbeforeunload = null');
  }
  for (const [id, button, expected] of [
    ['alert', 'OK', 'alert closed'],
    ['confirm', 'OK', 'confirm true'],
    ['prompt', 'OK', 'prompt default'],
    ['confirm', 'Cancel', 'confirm false'],
    ['prompt', 'Cancel', 'prompt null'],
  ] as const) {
    const lines = await pageLog(
      h,
      () => {
        // Ask for the press first and do not await: on iOS evaluate does not return while a dialog blocks the page.
        r.drive({ action: 'press', text: button });
        open(id);
      },
      15000
    );
    r.check(`${id} answered with ${button}`, lines?.join() === expected, lines);
  }
  if (Platform.OS === 'android') {
    const lines = await pageLog(h, async () => {
      open('confirm');
      await sleep(1000);
      r.drive({ action: 'back' });
    });
    r.check('back answers a confirm as Cancel', lines?.join() === 'confirm false', lines);
  }
  // UIKit runs a pressed button's handler only after the dismissal animation, so an unmount can come between the two.
  if (Platform.OS === 'ios') {
    await up('alert');
    const pressed = await seams.tapAlert('OK');
    const remounted = await happens(waitForLoad(h, () => h.remount()));
    await openPage(h, fresh(h, '/dialogs.html'));
    const lines = await pageLog(h, () => {
      void h.ref.current?.evaluate(
        `setTimeout(() => document.getElementById('confirm').click(), 0)`
      );
      setTimeout(() => void seams.tapAlert('OK'), 1000);
    });
    r.check(
      'an unmount right after OK is pressed completes the alert once',
      pressed && remounted && lines?.join() === 'confirm true',
      { pressed, remounted, lines }
    );
  }
}
