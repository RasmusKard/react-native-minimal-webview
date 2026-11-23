import { Platform } from 'react-native';

import {
  allowAsks,
  captureWarnings,
  clearEvents,
  errorCode,
  fresh,
  idle,
  nextEntry,
  openPage,
  sleep,
  startPageCall,
  travel,
  waitFor,
  happens,
  quietFor,
} from '../harness/helpers';
import { WEBVIEW, androidWebView, type Harness, type Reporter } from '../harness/runner';

export async function bfcache(h: Harness, r: Reporter) {
  await openPage(h, fresh(h, '/'));
  const first = await openPage(h, fresh(h, '/back-forward.html?title=first'));
  const second = await openPage(h, fresh(h, '/back-forward.html?title=second'));

  await travel(h, r, 'back', () => h.ref.current?.goBack(), first, 'first', true);
  await travel(h, r, 'forward', () => h.ref.current?.goForward(), second, 'second', false);

  await startPageCall(h, 'slow', null);
  const calledAt = Date.now();
  let leftAt: number | undefined;
  const sinceLeftOrCalled = () => Date.now() - (leftAt ?? calledAt);
  const inFlight = h.bridge.call('slow', { ms: 1500 }).then(
    (value) => ({ value, ms: sinceLeftOrCalled() }),
    (error: unknown) => ({ code: errorCode(error), ms: sinceLeftOrCalled() })
  );
  await sleep(200);
  leftAt = Date.now();
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
  await quietFor(2000);
  const straddle = (await h.ref.current?.evaluate('window.__call')) as
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
  const blocked = await nextEntry(
    h.events.navigations,
    () => h.ref.current?.evaluate(`location.href = '/blocked/page'`),
    (n) => n.url.endsWith('/blocked/page')
  );
  r.check(
    'a block rule holds on the restored page',
    blocked?.action === 'block' && h.state().url === second,
    { decision: blocked, state: h.state() }
  );
  await h.ref.current?.evaluate(`location.href = '/checkout/pay?bf=1'`);
  r.check(
    'an ask rule asks on the restored page and allow loads it',
    (await happens(waitFor(h, (s) => s.url.endsWith('/checkout/pay?bf=1') && idle(s), 5000))) &&
      asked.length === 1,
    { asked, state: h.state() }
  );

  if (Platform.OS === 'android') {
    const warnings = captureWarnings();
    h.setProps({ android: { settings: { backForwardCacheEnabled: true } } });
    const one = await openPage(h, fresh(h, '/back-forward.html?title=one'));
    await openPage(h, fresh(h, '/back-forward.html?title=two'));
    clearEvents(h);
    h.ref.current?.goBack();
    const back = await happens(waitFor(h, (s) => s.url === one && idle(s)));
    await quietFor(500);
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
}
