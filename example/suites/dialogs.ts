import { Platform } from 'react-native';
import { seams } from 'sample-extension';

import { fresh, openPage, pageLog, sleep, waitForLoad } from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';

/**
 * alert, confirm and prompt reach the user and their answers reach the page, and an unmount completes the dialog on
 * screen. The driver presses OK.
 */
export async function dialogs(h: Harness, r: Reporter) {
  const alertUp = async () => {
    await openPage(h, fresh(h, '/dialogs.html'));
    void h.ref.current?.evaluate(`setTimeout(() => document.getElementById('alert').click(), 0)`);
    await sleep(1000); // the presentation
  };
  // The presses below answer in the remounted WebView.
  await alertUp();
  r.check(
    'an unmount while an alert is up completes it',
    await waitForLoad(h, () => h.remount()),
    h.state()
  );
  await openPage(h, fresh(h, '/dialogs.html'));
  for (const [id, expected] of [
    ['alert', 'alert closed'],
    ['confirm', 'confirm true'],
    ['prompt', 'prompt default'],
  ] as const) {
    const lines = await pageLog(
      h,
      () => {
        // Ask for the press first and do not await: on iOS evaluate does not return while a dialog blocks the page.
        r.drive({ action: 'press', text: 'OK' });
        void h.ref.current?.evaluate(
          `setTimeout(() => document.getElementById('${id}').click(), 0)`
        );
      },
      15000
    );
    r.check(`${id} answered with OK`, lines?.join() === expected, lines);
  }
  // UIKit runs a pressed button's handler only after the dismissal animation, so an unmount can come between the two.
  if (Platform.OS === 'ios') {
    await alertUp();
    const pressed = await seams.tapAlert('OK');
    const remounted = await waitForLoad(h, () => h.remount());
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
