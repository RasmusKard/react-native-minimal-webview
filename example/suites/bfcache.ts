import { Platform } from 'react-native';

import {
  allowAsks,
  captureWarnings,
  clearEvents,
  errorCode,
  fresh,
  idle,
  nextDecision,
  openPage,
  sleep,
  travel,
  waitFor,
} from '../harness/helpers';
import { WEBVIEW, androidWebView, reporter, type Harness } from '../harness/runner';

/**
 * Back and forward restored from the back-forward cache (WebKit always, Android by default): the restore itself, the
 * navigation state, one onLoadStart/onLoadEnd per restore, the bridge both ways, and the rules on the restored
 * page.
 */
export async function bfcache(h: Harness) {
  const r = reporter('bfcache');
  await openPage(h, fresh(h, '/')); // so the first page has one before it
  const first = fresh(h, '/back-forward.html?title=first');
  await openPage(h, first);
  const second = fresh(h, '/back-forward.html?title=second');
  await openPage(h, second);

  await travel(h, r, 'back', () => h.ref.current?.goBack(), first, 'first', true);
  await travel(h, r, 'forward', () => h.ref.current?.goForward(), second, 'second', false);

  // A call still unanswered when its page goes into the cache rejects at once; the answer the page sends once restored
  // is dropped. Both ways: the page's call to the app's 'slow' (answered after 5 s) rejects in the page.
  const straddleCall = `(() => {
    window.__straddle = undefined;
    nativeBridge.call('slow').then((result) => (window.__straddle = { result }), (error) => (window.__straddle = { error: error.code }));
  })()`;
  await h.ref.current?.evaluate(straddleCall).catch(errorCode);
  // Without the bridge the call rejects at once, before the page is left.
  let left = Date.now();
  const inFlight = h.bridge.call('slow', { ms: 1500 }).then(
    (value) => ({ value, ms: Date.now() - left }),
    (error: unknown) => ({ code: errorCode(error), ms: Date.now() - left })
  );
  await sleep(200);
  left = Date.now();
  h.ref.current?.goBack();
  const settled = await inFlight;
  r.since(
    WEBVIEW.bridge,
    'a call in flight when the page is left rejects with navigated',
    'code' in settled && settled.code === 'navigated' && settled.ms < 1000,
    settled
  );
  await waitFor(h, (s) => s.url === first && idle(s));
  h.ref.current?.goForward();
  await waitFor(h, (s) => s.url === second && idle(s));
  await sleep(2000); // the restored page's timer fires and it answers the old call
  const straddle = (await h.ref.current?.evaluate('window.__straddle')) as
    { error?: string } | null | undefined;
  r.since(
    WEBVIEW.navigationListener,
    'a page -> RN call cut off by leaving the page rejects with navigated',
    straddle?.error === 'navigated',
    straddle
  );
  const after = await h.bridge.call('sum', { a: 1, b: 1 }).catch(errorCode);
  r.since(WEBVIEW.bridge, 'the bridge works after the late answer', after === 2, after);

  const asked = await allowAsks(h, [
    { path: ['/checkout'], action: 'ask' },
    { path: ['/blocked'], action: 'block' },
  ]);
  const blocked = await nextDecision(
    h,
    () => h.ref.current?.evaluate(`location.href = '/blocked/page'`),
    '/blocked/page'
  );
  r.check(
    'a block rule holds on the restored page',
    blocked?.action === 'block' && h.state().url === second,
    { decision: blocked, state: h.state() }
  );
  await h.ref.current?.evaluate(`location.href = '/checkout/pay?bf=1'`);
  r.check(
    'an ask rule asks on the restored page and allow loads it',
    (await waitFor(h, (s) => s.url.endsWith('/checkout/pay?bf=1') && idle(s), 5000)) &&
      asked.length === 1,
    { asked, state: h.state() }
  );

  if (Platform.OS === 'android') {
    // The app turns the cache on itself: below WebView 146 a restored page reports no load end, so it's refused there.
    const warnings = captureWarnings();
    h.setProps({ android: { settings: { backForwardCacheEnabled: true } } });
    const one = fresh(h, '/back-forward.html?title=one');
    await openPage(h, one);
    await openPage(h, fresh(h, '/back-forward.html?title=two'));
    clearEvents(h);
    h.ref.current?.goBack();
    const back = await waitFor(h, (s) => s.url === one && idle(s));
    await sleep(500); // a late load event would come now
    warnings.stop();
    r.check(
      'back with backForwardCacheEnabled set: one load start and end, finished',
      back &&
        JSON.stringify(h.events.loads) === '["start","end"]' &&
        JSON.stringify(h.events.outcomes) === '["finished"]',
      { loads: h.events.loads, outcomes: h.events.outcomes, state: h.state() }
    );
    r.check(
      'backForwardCacheEnabled: true warns only below WebView 146',
      warnings.warned('android.settings.backForwardCacheEnabled') ===
        androidWebView() < WEBVIEW.navigationListener,
      warnings.lines
    );
    h.setProps({});
  }
  r.done();
}
