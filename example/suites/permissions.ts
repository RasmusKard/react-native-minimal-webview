import { Platform } from 'react-native';
import type { PermissionRequest } from 'react-native-minimal-webview';

import {
  click,
  fresh,
  openPage,
  pageLog,
  sleep,
  stuckHandler,
  until,
  reachesJs,
} from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';
import { OTHER } from '../pages';

export async function permissionsSuite(h: Harness, r: Reporter) {
  r.drive({ action: 'setGpsFix' });
  const asked: PermissionRequest[] = [];
  let answer = false;
  let hold = false;
  const { stuck, never } = stuckHandler<boolean>();
  h.setPermission(async (request, signal) => {
    asked.push(request);
    return hold ? await never(signal) : answer;
  });
  const press = async (id: string) => (await pageLog(h, () => click(h, id)))?.join() ?? 'no result';
  await openPage(h, fresh(h, '/device.html'));
  answer = false;
  const denied = await press('camera');
  r.check('the app saying no denies the camera', denied.includes('NotAllowedError'), denied);
  r.check(
    'the request names origin and resource',
    asked[0]?.origin === h.pages && asked[0].resources.includes('camera'),
    asked[0]
  );

  answer = true;
  const granted = await press('camera');
  r.info('camera with app yes and OS permission', granted);
  if (Platform.OS === 'android') {
    r.check('app yes + OS permission grants the camera', granted.includes('camera ok'), granted);
    const geo = await press('geo');
    // The emulator may have no fix yet: the page then gets POSITION_UNAVAILABLE (2) or TIMEOUT (3), not PERMISSION_DENIED (1).
    r.check(
      'location granted with app yes + OS permission',
      /geo ok|geo error [23]/.test(geo),
      geo
    );
    await openPage(h, fresh(h, '/device.html'));
    answer = false;
    const geoDenied = await press('geo');
    r.check(
      'location denied when the app says no (PERMISSION_DENIED)',
      geoDenied.includes('geo error 1'),
      geoDenied
    );
  }

  let askedBefore = asked.length;
  for (const [name, frame] of [
    ['a cross-origin frame', `{ allow: 'camera', src: '${OTHER}/device.html?auto=camera' }`],
    // `camera *`: plain `camera` allows only the src's origin, so the page itself would refuse an opaque one.
    [
      'a sandboxed frame',
      `{ allow: 'camera *', sandbox: 'allow-scripts', src: '${OTHER}/device.html?auto=camera' }`,
    ],
  ]) {
    await openPage(h, fresh(h, '/device.html'));
    answer = true;
    askedBefore = asked.length;
    const framed =
      (
        await pageLog(h, () =>
          h.ref.current?.evaluate(
            `document.body.append(Object.assign(document.createElement('iframe'), ${frame}))`
          )
        )
      )?.join() ?? '';
    r.check(
      `${name} is denied without asking`,
      framed.includes('frame camera error') && asked.length === askedBefore,
      {
        framed,
        asked: asked.length - askedBefore,
      }
    );
  }

  await openPage(h, fresh(h, '/device.html'));
  hold = true;
  askedBefore = asked.length;
  await click(h, 'camera');
  await reachesJs(r, () => asked.length, askedBefore);
  hold = false;
  const navigatedAt = Date.now();
  await openPage(h, fresh(h, '/device.html'));
  await until(() => stuck.abortedAt, 2000);
  r.check(
    "navigating away aborts the held handler's signal within 2 s",
    stuck.abortedAt > 0 && stuck.abortedAt - navigatedAt < 2000,
    stuck.abortedAt ? stuck.abortedAt - navigatedAt : 'not aborted'
  );
  answer = false;
  const again = await press('camera');
  r.check(
    'after navigating, the page asks again and gets the answer',
    asked.length === askedBefore + 2 && again.includes('NotAllowedError'),
    { asked: asked.length - askedBefore, again }
  );
  stuck.release(true);
  await sleep(300);
  r.check(
    'a late answer for the replaced page changes nothing',
    (await h.ref.current?.evaluate('1 + 1')) === 2
  );
  answer = true;

  if (Platform.OS === 'android') {
    h.setProps({ onPermissionRequest: undefined });
    await sleep(300);
    askedBefore = asked.length;
    const unhandled = await press('camera');
    r.check(
      'without onPermissionRequest the camera is denied',
      unhandled.includes('NotAllowedError') && asked.length === askedBefore,
      unhandled
    );
    h.setProps({});
    await sleep(300);
    const restored = await press('camera');
    r.check(
      'onPermissionRequest set again takes over without a remount',
      restored.includes('camera ok') && asked.length > askedBefore,
      restored
    );
  }
}
