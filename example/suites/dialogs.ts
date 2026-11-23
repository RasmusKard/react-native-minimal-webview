import { Platform } from 'react-native';
import { seams } from 'sample-extension';

import {
  fresh,
  happens,
  openPage,
  pageLog,
  poll,
  touch,
  waitFor,
  waitForLoad,
  waitForPresentation,
  clickWithoutWaiting,
} from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';

export async function dialogs(h: Harness, r: Reporter) {
  const up = async (id: string) => {
    await openPage(h, fresh(h, '/dialogs.html'));
    clickWithoutWaiting(h, id);
    await waitForPresentation();
  };
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
  if (Platform.OS === 'ios') {
    r.skip('beforeunload answered with Stay keeps the page', 'WebKit has no beforeunload dialog');
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
    r.skip(
      'an unmount or a crash closes the dialog on screen',
      "Android's WebView leaves its dialog on screen when it is destroyed, and one older than 149 then gets no touches (https://crbug.com/504317449)"
    );
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
        r.drive({ action: 'press', text: button });
        clickWithoutWaiting(h, id);
      },
      15000
    );
    r.check(`${id} answered with ${button}`, lines?.join() === expected, lines);
  }
  if (Platform.OS === 'android') {
    const lines = await pageLog(h, async () => {
      clickWithoutWaiting(h, 'confirm');
      await waitForPresentation();
      r.drive({ action: 'back' });
    });
    r.check('back answers a confirm as Cancel', lines?.join() === 'confirm false', lines);
  } else r.skip('back answers a confirm as Cancel', 'iOS has no back button');
  if (Platform.OS === 'ios') {
    await up('alert');
    const pressed = await seams.tapAlert('OK');
    const remounted = await happens(waitForLoad(h, () => h.remount()));
    await openPage(h, fresh(h, '/dialogs.html'));
    const lines = await pageLog(h, () => {
      clickWithoutWaiting(h, 'confirm');
      setTimeout(() => void seams.tapAlert('OK'), 1000);
    });
    r.check(
      'an unmount right after OK is pressed completes the alert once',
      pressed && remounted && lines?.join() === 'confirm true',
      { pressed, remounted, lines }
    );
  } else
    r.skip(
      'an unmount right after OK is pressed completes the alert once',
      'tapAlert, the seam that presses OK, is iOS only'
    );
}
