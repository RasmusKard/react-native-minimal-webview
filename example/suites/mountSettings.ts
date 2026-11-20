import { Platform } from 'react-native';
import { AndroidWebView } from 'react-native-minimal-webview';

import {
  allowAsks,
  click,
  errorCode,
  fresh,
  idle,
  openPage,
  recreate,
  text,
  viewportHeight,
  waitFor,
  happens,
} from '../harness/helpers';
import { WEBVIEW, type Harness, type Reporter } from '../harness/runner';

/**
 * A creation-time setting changed while mounted recreates the WebView (iOS: an `ios.configuration` key; Android has
 * none, so a remount stands in); afterwards the page, the bridge, the extensions and `ask` must all still work.
 */
export async function mountSettings(h: Harness, r: Reporter) {
  const uaOf = async () => {
    await openPage(h, fresh(h, '/ua'));
    return await text(h, 'ua');
  };
  const page = fresh(h, '/bridge.html');
  await openPage(h, page);
  await recreate(
    h,
    Platform.OS === 'ios'
      ? { ios: { configuration: { applicationNameForUserAgent: 'Remounted/9' } } }
      : {
          android: {
            settings: { userAgentString: `${AndroidWebView.defaultUserAgent} Remounted/9` },
          },
        },
    Platform.OS === 'android'
  );
  const remountedVh = await viewportHeight(h);
  r.check('100vh has a height after the recreation', remountedVh > 0, remountedVh);
  const ua = await uaOf();
  r.check(
    'a changed creation-time setting recreates the WebView and applies',
    ua.endsWith(' Remounted/9'),
    ua
  );
  await openPage(h, fresh(h, '/bridge.html'));
  r.since(
    WEBVIEW.bridge,
    'the bridge works after the remount',
    (await h.bridge.call('sum', { a: 3, b: 4 }).catch(errorCode)) === 7
  );
  const asked = await allowAsks(h, [{ path: ['/checkout'], action: 'ask' }]);
  await openPage(h, fresh(h, '/nav.html'));
  await click(h, 'checkout');
  const reached = await happens(
    waitFor(h, (s) => s.url.endsWith('/checkout/pay') && idle(s), 8000)
  );
  r.check('ask works after the remount', reached && asked.length > 0, { reached, asked });
}
