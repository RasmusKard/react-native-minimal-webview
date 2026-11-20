import { Platform } from 'react-native';
import { IOSConstants } from 'react-native-minimal-webview';

import {
  captureWarnings,
  errorCode,
  fresh,
  openPage,
  recreate,
  sleep,
  poll,
} from '../harness/helpers';
import { WEBVIEW, type Harness, type Reporter } from '../harness/runner';

/** `ios` / `android` settings by name: applied live, seen by the page, rejected with a warning when wrong; get and call. */
export async function settings(h: Harness, r: Reporter) {
  const { lines: warnings, warned, stop } = captureWarnings();
  r.cleanup(stop);
  const page = (expression: string) => h.ref.current?.evaluate(expression).catch(errorCode);
  const get = (key: string) => h.ref.current?.get(key).catch(errorCode);
  /** Whether `read` gives `want` within 3 s: a setting reaches the WebView, and the page, on their own schedule. */
  const becomes = async (read: () => Promise<unknown> | undefined, want: unknown) =>
    !!(await poll(async () => (await read()) === want, 3000));
  // An 8px span's computed size: the minimum font size setting raises it.
  const fontSize = () =>
    page(`(() => {
      const s = document.createElement('span'); s.style.fontSize = '8px'; s.textContent = 'x'; document.body.append(s);
      const size = getComputedStyle(s).fontSize; s.remove(); return size;
    })()`);
  try {
    await openPage(h, fresh(h, '/'));
    if (Platform.OS === 'ios') {
      const configuration = { applicationNameForUserAgent: 'Settings/1' };
      const preferences = { minimumFontSize: 30 };
      await recreate(h, {
        ios: {
          configuration,
          preferences,
          scrollView: { other: { nope: 1 } },
        },
      });
      r.check('a WKPreferences number applies', (await fontSize()) === '30px', await fontSize());
      r.check(
        'an unknown property warns',
        warned('ios.scrollView.nope: no such property'),
        warnings
      );
      // The same configuration from here on, so this is the same WebView.
      h.setProps({ ios: { configuration, preferences: { minimumFontSize: 'big' as never } } });
      await sleep(500);
      r.check('and leaves the property alone', (await fontSize()) === '30px', await fontSize());
      await openPage(h, fresh(h, '/ptr.html?mode=long'));
      h.setProps({
        ios: {
          configuration,
          scrollView: {
            contentInsetAdjustmentBehavior: IOSConstants.ContentInsetAdjustmentBehavior.never,
            contentOffset: { x: 0, y: 30 },
          },
        },
      });
      r.check(
        'a UIScrollView struct applies',
        await becomes(() => page('scrollY'), 30),
        await page('scrollY')
      );
      // Removed by the update that set the offset, which has applied.
      r.check(
        'a removed key (preferences.minimumFontSize) goes back to its start-up value',
        (await get('preferences.minimumFontSize')) === 0
      );
      const width = (await page('innerWidth')) as number;
      h.setProps({ ios: { configuration, webView: { pageZoom: 2 } } });
      const zoomedIn = await poll(
        async () => Math.abs(((await page('innerWidth')) as number) * 2 - width) <= 2,
        3000
      );
      r.check('a WKWebView number applies', !!zoomedIn, {
        width,
        zoomed: await page('innerWidth'),
      });
      h.setProps({
        ios: {
          configuration,
          webpagePreferences: { preferredContentMode: IOSConstants.ContentMode.desktop },
        },
      });
      await becomes(
        () => get('webpagePreferences.preferredContentMode'),
        IOSConstants.ContentMode.desktop
      );
      await openPage(h, fresh(h, '/'));
      const desktop = await page('navigator.userAgent');
      r.check(
        'a WKWebpagePreferences enum applies from the next navigation',
        String(desktop).includes('Macintosh'),
        desktop
      );
      h.setProps({
        ios: {
          configuration,
          scrollView: { bounces: false, contentInset: { top: 5, left: 0, bottom: 0, right: 0 } },
        },
      });
      // bounces starts out true; the inset comes in the same update.
      r.check('get reads a BOOL', await becomes(() => get('scrollView.bounces'), false));
      const inset = (await get('scrollView.contentInset')) as Record<string, number> | undefined;
      r.check(
        'get reads a struct',
        inset?.top === 5 && inset.left === 0 && inset.bottom === 0 && inset.right === 0,
        inset
      );
      r.check(
        'get reads a configuration property',
        (await get('configuration.applicationNameForUserAgent')) === 'Settings/1'
      );
      r.check(
        'get rejects for an unknown property',
        (await get('scrollView.nope')) === 'not_found'
      );
      const call = (method: string, args?: unknown[]) =>
        h.ref.current?.call(method, args).catch(errorCode);
      // The site data clear below removes this cookie.
      const value = String(Date.now());
      const setCookie = (cookie: Record<string, string>) =>
        call('httpCookieStore.setCookie:completionHandler:', [{ cookie }]);
      const stored = await setCookie({
        Name: 'mrwCall',
        Value: value,
        Domain: 'localhost',
        Path: '/',
      });
      const cookies = (await call('httpCookieStore.getAllCookies:')) as
        { Name: string; Value: string }[] | string | undefined;
      r.check(
        'call takes { cookie } and resolves an NSHTTPCookie as its properties',
        stored === null &&
          Array.isArray(cookies) &&
          cookies.some((c) => c.Name === 'mrwCall' && c.Value === value),
        { stored, cookies }
      );
      r.check(
        "call rejects a cookie that can't be made (no domain or path)",
        (await setCookie({ Name: 'mrwCall', Value: value })) === 'native_error'
      );
      await page(`(document.cookie = 'mrw=1; path=/')`);
      const before = await page('document.cookie');
      const cleared = await call(
        'websiteDataStore.removeDataOfTypes:modifiedSince:completionHandler:',
        [{ set: [IOSConstants.WebsiteDataType.cookies] }, { date: 0 }]
      );
      r.check(
        'call clears site data (a void completion handler)',
        String(before).includes('mrw=1') &&
          cleared === null &&
          (await page('document.cookie')) === '',
        { before, cleared }
      );
      const pdf = await call('webView.createPDFWithConfiguration:completionHandler:', [null]);
      r.check(
        'call resolves NSData as base64',
        typeof pdf === 'string' && pdf.length > 100 && pdf.startsWith('JVBERi0'),
        String(pdf).slice(0, 20)
      );
      const png = await call('webView.takeSnapshotWithConfiguration:completionHandler:', [null]);
      r.check(
        'call resolves a UIImage as a PNG',
        typeof png === 'string' && png.startsWith('iVBORw0KGgo'),
        String(png).slice(0, 20)
      );
      const records = await call('websiteDataStore.fetchDataRecordsOfTypes:completionHandler:', [
        { set: [IOSConstants.WebsiteDataType.localStorage] },
      ]);
      r.check('call resolves a value completion handler', Array.isArray(records), records);
      const playback = await call('webView.requestMediaPlaybackStateWithCompletionHandler:');
      r.check(
        'call resolves an integer completion handler (no media: none)',
        playback === IOSConstants.MediaPlaybackState.none,
        playback
      );
      // iOS 18 selectors: below it the call rejects with not_found, so the checks are skipped.
      if (parseFloat(String(Platform.Version)) >= 18) {
        await page(`sessionStorage.setItem('mrw', '1')`);
        const session = await call('webView.fetchDataOfTypes:completionHandler:', [
          IOSConstants.WebViewDataType.sessionStorage,
        ]);
        const restored = await call('webView.restoreData:completionHandler:', [{ data: session }]);
        r.check(
          'call takes NSData and an error completion handler',
          typeof session === 'string' && session.length > 0 && restored === null,
          { session: String(session).slice(0, 12), restored }
        );
      } else r.info('call takes NSData: needs iOS 18', Platform.Version);
      r.check(
        'get reads a websiteDataStore property',
        (await get('websiteDataStore.persistent')) === true
      );
      await call('scrollView.setContentOffset:animated:', [{ x: 0, y: 30 }, false]);
      const offset = (await get('scrollView.contentOffset')) as { y: number } | undefined;
      r.check('call takes a struct and a BOOL', offset?.y === 30, offset);
      r.check(
        'call refuses a core-owned selector',
        (await call('webView.loadRequest:', [null])) === 'native_error'
      );
      r.check(
        'call refuses a private selector',
        (await call('webView._nope', [])) === 'native_error'
      );
      r.check(
        'call refuses init, and the WebView still works',
        (await call('webView.init', [])) === 'native_error' && (await page('1+1')) === 2
      );
      r.check(
        'call rejects a wrong argument count',
        (await call('scrollView.setContentOffset:animated:', [{ x: 0, y: 0 }])) === 'native_error'
      );
      const transparent = await call('webView.setOpaque:', [false]);
      const opaque = await call('webView.isOpaque', []);
      r.check(
        'call makes the WebView transparent (setOpaque: false), and isOpaque reads back false',
        transparent === null && opaque === false,
        { transparent, opaque }
      );
    } else {
      const payment = () => page(`typeof PaymentRequest`);
      const paymentBefore = await payment();
      const fontBefore = await get('settings.minimumFontSize');
      h.setProps({
        android: {
          settings: { minimumFontSize: 30, paymentRequestEnabled: true },
          webView: { networkAvailable: false, other: { webViewClient: null } },
        },
      });
      // The renderer process keeps navigator.onLine for later WebViews: put it back, also when a check below throws.
      r.cleanup(async () => {
        h.setProps({ android: { webView: { networkAvailable: true } } });
        await sleep(300);
      });
      r.check('a WebSettings setter applies', await becomes(fontSize, '30px'), await fontSize());
      r.check('a WebView setter applies', await becomes(() => page('navigator.onLine'), false));
      await openPage(h, fresh(h, '/'));
      const paymentAfter = await payment();
      r.since(
        WEBVIEW.paymentRequest,
        'a setter only WebSettingsCompat has applies (through reflection on androidx)',
        paymentBefore === 'undefined' && paymentAfter === 'function',
        { paymentBefore, paymentAfter }
      );
      r.check(
        'a core-owned setter warns',
        warned('android.webView.webViewClient: owned by the core'),
        warnings
      );
      // The renderer process keeps navigator.onLine for later WebViews: put it back.
      h.setProps({
        android: {
          settings: { minimumFontSize: 'big' as never, paymentRequestEnabled: true },
          webView: { networkAvailable: true },
        },
      });
      // The rejected minimumFontSize comes in the same update as networkAvailable.
      const restored = await becomes(() => page('navigator.onLine'), true);
      r.check('and leaves the setting alone', (await fontSize()) === '30px', await fontSize());
      r.check('networkAvailable is restored', restored);
      r.check('get reads a WebSettings getter', (await get('settings.minimumFontSize')) === 30);
      r.since(
        WEBVIEW.paymentRequest,
        'get reads a WebSettingsCompat getter',
        (await get('settings.paymentRequestEnabled')) === true
      );
      r.check('get reads an is-getter', (await get('webView.verticalScrollBarEnabled')) === true);
      r.check('get rejects for an unknown key', (await get('settings.nope')) === 'not_found');
      const call = (method: string, args?: unknown[]) =>
        h.ref.current?.call(method, args).catch(errorCode);
      r.check('call runs a WebView method', (await call('webView.clearCache', [true])) === null);
      r.check('call returns the result', (await call('webView.getTitle')) === 'Test pages');
      r.check(
        'call rejects for a core-owned method',
        (await call('webView.destroy')) === 'native_error'
      );
      const origin = String(await page('location.origin'));
      const set = await call('cookieManager.setCookie', [origin, 'mrwSet=2']);
      const read = await call('cookieManager.getCookie', [origin]);
      r.check(
        'call sets and reads a cookie through cookieManager',
        set === null && String(read).includes('mrwSet=2'),
        { set, read }
      );
      await page(`(document.cookie = 'mrw=1; path=/')`);
      const before = await page('document.cookie');
      // No callback in the args: the call resolves once the cookies are gone, with whether there were any.
      const removed = await call('cookieManager.removeAllCookies');
      r.check(
        'call awaits a ValueCallback: cookieManager.removeAllCookies',
        String(before).includes('mrw=1') &&
          removed === true &&
          (await page('document.cookie')) === '',
        { before, removed }
      );
      r.check('call reaches webStorage', (await call('webStorage.deleteAllData')) === null);
      // WebView has no getter for it: the check is that it applies.
      h.setProps({ android: { webView: { other: { backgroundColor: 0 } } } });
      await sleep(500);
      r.check(
        'android.webView.backgroundColor 0 (transparent) applies without a warning',
        !warned('android.webView.backgroundColor'),
        warnings
      );
      r.check(
        'a removed key (settings.minimumFontSize) goes back to its start-up value',
        (await get('settings.minimumFontSize')) === fontBefore,
        { fontBefore }
      );
    }
  } finally {
    stop();
  }
}
