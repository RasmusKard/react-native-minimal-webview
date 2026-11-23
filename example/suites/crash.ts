import { AppState, Platform } from 'react-native';
import type { ProcessGoneEvent } from 'react-native-minimal-webview';
import { sampleHook, seams } from 'sample-extension';

import {
  USER_AGENT_KEY,
  clearEvents,
  errorCode,
  fresh,
  idle,
  openPage,
  sleep,
  text,
  until,
  viewportHeight,
  waitFor,
  waitForLoad,
  happens,
  poll,
  waitForPresentation,
} from '../harness/helpers';
import { WEBVIEW, type Harness, type Reporter } from '../harness/runner';

const CORE_CRASH_WINDOW_MS = 60_000;
const ANDROID_SAME_CRASH_MS = 100;
const WITHIN_CRASH_WINDOW_MS = CORE_CRASH_WINDOW_MS - 5_000;
const RESUME_SKEW_MS = 1500;

export async function crash(h: Harness, r: Reporter) {
  const page = fresh(h, '/bridge.html');
  const kill = async (n: number, action: 'kill' | 'killInBackground' = 'kill') => {
    const before = h.events.gone.length;
    const rendererAnswers = () =>
      Promise.race([
        h.ref.current?.evaluate('1').then(
          () => true,
          () => false
        ),
        sleep(1000).then(() => false),
      ]);
    await until(rendererAnswers);
    await sleep(ANDROID_SAME_CRASH_MS + 50);
    r.drive({ action }, n);
    await waitFor(h, () => h.events.gone.length > before, 15000);
    return h.events.gone[before];
  };
  const pageUserAgent = () =>
    poll(
      async () =>
        (await h.ref.current?.evaluate('navigator.userAgent').catch(errorCode)) === 'Crash/1'
    );
  h.setProps({ userAgent: 'Crash/1' });
  await until(
    async () => (await h.ref.current?.get(USER_AGENT_KEY).catch(errorCode)) === 'Crash/1'
  );
  await openPage(h, page);
  const startCrashCountOver = () => h.ref.current?.reload();
  await waitForLoad(h, startCrashCountOver, (s) => s.url === page && idle(s));
  r.info('a setting before the crash', await pageUserAgent());
  clearEvents(h);
  const firstKillAt = Date.now();
  const countsBefore = h.events.pageCounts.length;
  let first: ProcessGoneEvent | undefined;
  const reloaded = await happens(
    waitForLoad(
      h,
      async () => (first = await kill(1)),
      (s) => s.url === page && idle(s)
    )
  );
  r.check('processGone reported and recovered', first?.recovered === true, first);
  r.check('the page reloads', reloaded, h.state());
  const second = fresh(h, '/bridge.html');
  await waitForLoad(
    h,
    () => h.ref.current?.evaluate(`location.href = ${JSON.stringify(second)}`),
    (s) => s.url === second && idle(s)
  );
  let killed: ProcessGoneEvent | undefined;
  const inPlace = await happens(
    waitForLoad(
      h,
      async () => (killed = await kill(2)),
      (s) => s.url === second && idle(s) && s.canGoBack
    )
  );
  r.check(
    'a second page reloads in place, canGoBack unchanged',
    killed?.recovered === true && inPlace,
    h.state()
  );
  h.ref.current?.goBack();
  r.check(
    'back after recovery goes to the page before it, with forward kept',
    await happens(waitFor(h, (s) => s.url === page && idle(s) && s.canGoForward, 15000)),
    h.state()
  );
  r.check(
    'the hooks are attached after recovery',
    await happens(waitFor(h, () => h.events.pageCounts.length > countsBefore, 5000)),
    h.events.pageCounts.length - countsBefore
  );
  const recoveredVh = await viewportHeight(h);
  r.check('100vh has a height after recovery', recoveredVh > 0, recoveredVh);
  r.since(
    WEBVIEW.bridge,
    'the bridge works after recovery',
    (await h.bridge.call('sum', { a: 2, b: 2 }).catch(errorCode)) === 4
  );
  r.check('the setting is still applied after recovery', !!(await pageUserAgent()));

  await waitForLoad(h, () => kill(3));
  await until(
    async () =>
      (await h.ref.current?.evaluate('document.readyState').catch(errorCode)) === 'complete'
  );
  const slowStarts = h.events.loads.length;
  await h.ref.current
    ?.evaluate(`location.href = ${JSON.stringify(fresh(h, '/slow?ms=10000'))}`)
    .catch(errorCode);
  await poll(() => h.events.loads.slice(slowStarts).includes('start'), 2000);
  const fourth = await kill(4);
  const onScreen = h.state().url;
  const elapsed = Date.now() - firstKillAt;
  if (elapsed < WITHIN_CRASH_WINDOW_MS)
    r.check(
      'a crash loop stops reloading (4th crash in 60 s)',
      fourth?.recovered === false,
      fourth
    );
  else
    r.skip('a crash loop stops reloading (4th crash in 60 s)', `the 4 crashes took ${elapsed} ms`);
  r.since(
    WEBVIEW.navigationListener,
    'a crash during a load before it commits ends it as failed',
    (await happens(waitFor(h, (s) => !s.loading, 5000))) && h.state().outcome === 'failed',
    h.state()
  );
  const brings = async (action: () => void, url: string) =>
    (await happens(waitForLoad(h, action, (s) => s.url === url && idle(s)))) &&
    (await h.ref.current?.evaluate('location.href').catch(errorCode)) === url;
  r.check(
    'reload() brings the page back after giving up',
    await brings(() => h.ref.current?.reload(), onScreen),
    h.state()
  );
  r.check(
    'loading a new source works after giving up',
    await happens(openPage(h, fresh(h, '/'))),
    h.state()
  );
  const loopAt = Date.now();
  r.check(
    'a crash after reload() and a new source recovers',
    (await kill(5))?.recovered === true,
    h.events.gone.at(-1)
  );
  for (const n of [6, 7]) await waitForLoad(h, () => kill(n));
  const eighth = await kill(8);
  if (Date.now() - loopAt < WITHIN_CRASH_WINDOW_MS)
    r.check('a crash loop stops reloading again', eighth?.recovered === false, eighth);
  else r.skip('a crash loop stops reloading again', `the 4 crashes took ${Date.now() - loopAt} ms`);
  const loaded = fresh(h, '/bridge.html');
  r.check(
    'load() loads after giving up',
    await brings(() => h.ref.current?.load(loaded), loaded),
    h.state()
  );
  r.check(
    'a crash after load() recovers: it starts the limit over',
    (await kill(9))?.recovered === true,
    h.events.gone.at(-1)
  );

  h.loadSource({ html: '<p id="marker">html source</p>', baseUrl: h.pages });
  const marker = () =>
    h.ref.current
      ?.evaluate(`document.getElementById('marker')?.textContent ?? null`)
      .catch(errorCode);
  const shown = async () => !!(await poll(async () => (await marker()) === 'html source'));
  r.check('an html source is shown', await shown(), await marker());
  r.check(
    'processGone reported and recovered (html source)',
    (await kill(10))?.recovered === true,
    h.events.gone.at(-1)
  );
  r.check('the html source is shown again after recovery', await shown(), await marker());

  const post = fresh(h, '/post');
  const body = `amount=9.99&t=${Date.now()}`;
  await openPage(h, { uri: post, body }, 10000);
  const postGone = await kill(11);
  r.check('a POST source is not sent again on recovery', postGone?.recovered === false, postGone);
  await waitForLoad(h, () => h.ref.current?.reload());
  r.check(
    'reload() sends the POST source after a crash',
    (await text(h, 'body')) === body,
    h.state()
  );

  const away = fresh(h, '/bridge.html');
  await openPage(h, away);
  const states: { state: string; at: number }[] = [];
  const appState = AppState.addEventListener('change', (state) =>
    states.push({ state, at: Date.now() })
  );
  r.cleanup(() => appState.remove());
  let backgroundGone: ProcessGoneEvent | undefined;
  const recovered = await happens(
    waitForLoad(
      h,
      async () => (backgroundGone = await kill(12, 'killInBackground')),
      (s) => s.url === away && idle(s),
      30000
    )
  );
  appState.remove();
  const activeAt = states.find((s) => s.state === 'active')?.at ?? Infinity;
  const loadedAt = await h.ref.current?.evaluate('performance.timeOrigin').catch(errorCode);
  r.check(
    'a crash in the background reloads once the app is active',
    backgroundGone?.recovered === true &&
      recovered &&
      typeof loadedAt === 'number' &&
      loadedAt > activeAt - RESUME_SKEW_MS,
    {
      backgroundGone,
      recovered,
      states,
      loadedAt,
      startedBeforeActive: activeAt - Number(loadedAt),
    }
  );

  const asked = fresh(h, '/bridge.html');
  h.setProps({
    userAgent: 'Crash/1',
    onProcessGone: (event) => {
      h.events.gone.push(event);
      h.ref.current?.load(asked);
    },
  });
  const loadedOnTop = await happens(
    waitForLoad(
      h,
      () => kill(13, 'killInBackground'),
      (s) => s.url === asked && idle(s),
      30000
    )
  );
  h.ref.current?.goBack();
  r.check(
    'a load() while the recovery waits keeps the history',
    loadedOnTop && (await happens(waitFor(h, (s) => s.url === away && idle(s), 15000))),
    h.state()
  );
  h.setProps({ userAgent: 'Crash/1' });

  if (Platform.OS === 'android') {
    await openPage(h, fresh(h, '/bridge.html'));
    const target = fresh(h, '/bridge.html');
    const since = Date.now();
    const settles = (call: Promise<unknown> | undefined) =>
      Promise.race([
        Promise.resolve(call).then(() => 'resolved', errorCode),
        sleep(3000).then(() => 'hung'),
      ]);
    let answers: Promise<unknown[]> | undefined;
    h.setProps({
      userAgent: 'Crash/1',
      onProcessGone: (event) => {
        h.events.gone.push(event);
        const ref = h.ref.current;
        ref?.goBack();
        ref?.goForward();
        ref?.stopLoading();
        answers = Promise.all(
          [
            ref?.evaluate('1'),
            ref?.get(USER_AGENT_KEY),
            ref?.call('webView.getTitle'),
            ref?.hook('sample.pageCounter', 'count'),
          ].map(settles)
        );
        ref?.load(target);
        h.setProps({
          userAgent: 'Crash/2',
          injectedScripts: [{ code: 'window.__injected = 1', origins: ['*'] }],
          extensions: [sampleHook('seams')],
        });
      },
    });
    const recovered = await happens(
      waitForLoad(
        h,
        () => kill(16, 'killInBackground'),
        (s) => s.url === target && idle(s),
        30000
      )
    );
    const refused = await seams.destroyedWebViewCalls(since);
    const settled = await answers;
    r.check(
      'calls while the recovery waits reach no destroyed WebView, and each rejects unavailable',
      recovered && refused === 0 && settled?.every((a) => a === 'unavailable') === true,
      { recovered, refused, settled, state: h.state() }
    );
    const applied = {
      userAgent: await h.ref.current?.evaluate('navigator.userAgent').catch(errorCode),
      injected: await h.ref.current?.evaluate('window.__injected').catch(errorCode),
      hook: await h.ref.current?.hook('sample.seams', 'twice', [2]).catch(errorCode),
    };
    r.check(
      'props set while the recovery waits apply to the recovered WebView',
      applied.userAgent === 'Crash/2' && applied.hook === 4,
      applied
    );
    r.since(
      WEBVIEW.injectedScripts,
      'injectedScripts set while the recovery waits apply to the recovered WebView',
      applied.injected === 1,
      applied
    );
    h.setProps({ userAgent: 'Crash/1' });
  }

  // Android keeps the window of a view under a modal, so this is iOS's case.
  if (Platform.OS === 'ios') {
    const under = fresh(h, '/bridge.html');
    await openPage(h, under);
    h.setCovered(true);
    await waitForPresentation();
    const starts = h.events.loads.length;
    const coveredGone = await kill(14);
    await sleep(2000);
    const whileCovered = h.events.loads.slice(starts);
    const uncovered = await happens(
      waitForLoad(
        h,
        () => h.setCovered(false),
        (s) => s.url === under && idle(s)
      )
    );
    r.check(
      'a crash out of the window reloads once the view is back in one',
      coveredGone?.recovered === true && whileCovered.length === 0 && uncovered,
      { coveredGone, whileCovered, state: h.state() }
    );
  }

  if (Platform.OS === 'android') {
    const loadStarts = h.events.loads.length;
    const outcomes = h.events.outcomes.length;
    h.loadSource({ html: '<img src="/slow?ms=10000">', baseUrl: h.pages });
    await until(
      async () =>
        h.state().loading &&
        (await h.ref.current?.evaluate('document.readyState').catch(errorCode)) === 'interactive'
    );
    let endedBeforeGone: boolean | undefined;
    h.setProps({
      userAgent: 'Crash/1',
      onProcessGone: (event) => {
        h.events.gone.push(event);
        endedBeforeGone ??= h.events.loads.slice(loadStarts).includes('end');
      },
    });
    await kill(15);
    r.check(
      'onProcessGone comes before the onLoadEnd that fails the committed load it cut off',
      (await happens(waitFor(h, () => h.events.outcomes.length > outcomes, 5000))) &&
        endedBeforeGone === false &&
        h.events.outcomes[outcomes] === 'failed',
      { endedBeforeGone, outcomes: h.events.outcomes.slice(outcomes) }
    );
  }
}
