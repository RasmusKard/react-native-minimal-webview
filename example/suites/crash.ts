import { AppState, Platform } from 'react-native';
import type { ProcessGoneEvent } from 'react-native-minimal-webview';

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
} from '../harness/helpers';
import { WEBVIEW, type Harness, type Reporter } from '../harness/runner';

/** Kill the web content process: the core reloads, the bridge works again, and a crash loop stops reloading. */
export async function crash(h: Harness, r: Reporter) {
  const page = fresh(h, '/bridge.html');
  /** Asks the driver for kill `n` (`action`: with the app in front, or away) and waits for its onProcessGone. */
  const kill = async (n: number, action: 'kill' | 'killInBackground' = 'kill') => {
    const before = h.events.gone.length;
    // Kill only a live renderer: an evaluate round trip needs one (a kill during recovery would find none).
    // An evaluate that the recovery's navigation rejects also proves nothing yet: wait for one that answers.
    const answers = () =>
      Promise.race([
        h.ref.current?.evaluate('1').then(
          () => true,
          () => false
        ),
        sleep(1000).then(() => false),
      ]);
    await until(answers);
    // Android counts renderer deaths within 100 ms as one crash (SAME_CRASH_MS); a fast recovery gets there first.
    await sleep(150);
    r.drive({ action }, n);
    await waitFor(h, () => h.events.gone.length > before, 15000);
    return h.events.gone[before];
  };
  // A setting the page can see, to check after recovery.
  const userAgent = () =>
    poll(
      async () =>
        (await h.ref.current?.evaluate('navigator.userAgent').catch(errorCode)) === 'Crash/1'
    );
  h.setProps({ userAgent: 'Crash/1' });
  await until(
    async () => (await h.ref.current?.get(USER_AGENT_KEY).catch(errorCode)) === 'Crash/1'
  );
  await openPage(h, page);
  r.info('a setting before the crash', await userAgent());
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
  // A page other than the source reloads its history entry in place: back still goes to the page before it, and
  // forward from there to it (Android restores the dead WebView's history into the new one). This is the second of
  // the crash loop's kills.
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
  // Android attaches the hooks to the new WebView; iOS keeps the delegates: the sample's page counter still counts.
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
  // Android builds a new WebView on recovery: its settings must be applied again.
  r.check('the setting is still applied after recovery', !!(await userAgent()));

  // The recovery reload ends first: before WebView 146 the state reads idle before it starts, and it would cut off
  // the navigation below.
  await waitForLoad(h, () => kill(3));
  // The 4th kill cuts off a slow load: with no reload to end it, the core must. Before WebView 146 the load starts at
  // commit, after the delay, so the kill lands on the committed slow page instead.
  await until(
    async () =>
      (await h.ref.current?.evaluate('document.readyState').catch(errorCode)) === 'complete'
  );
  const slowStarts = h.events.loads.length;
  await h.ref.current
    ?.evaluate(`location.href = ${JSON.stringify(fresh(h, '/slow?ms=10000'))}`)
    .catch(errorCode); // the navigation it starts can end its document first
  await waitFor(h, () => h.events.loads.slice(slowStarts).includes('start'));
  const fourth = await kill(4);
  const onScreen = h.state().url; // the page on screen: the retry below brings it back
  // Only meaningful when all four crashes fell inside the 60 s window (slow reloads can stretch the test past it).
  const elapsed = Date.now() - firstKillAt;
  if (elapsed < 55000)
    r.check(
      'a crash loop stops reloading (4th crash in 60 s)',
      fourth?.recovered === false,
      fourth
    );
  else
    r.skip('a crash loop stops reloading (4th crash in 60 s)', `the 4 crashes took ${elapsed} ms`);
  r.check(
    'a crash during a load ends it (loading: false)',
    await happens(waitFor(h, (s) => !s.loading, 5000)),
    h.state()
  );
  // The action loads `url`, and the page itself agrees it is there.
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
  // load() as reload() above: a crash loop again, then load() loads and starts the limit over.
  for (const n of [6, 7]) await waitForLoad(h, () => kill(n));
  const eighth = await kill(8);
  if (Date.now() - loopAt < 55000)
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

  // An html source has no URL to fetch (the URL is its baseUrl): recovery loads the source again.
  h.loadSource({ html: '<p id="marker">html source</p>', baseUrl: h.pages });
  // An evaluate that the recovery's navigation rejects is expected while polling; its error code shows in the result.
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

  // A POST source on screen isn't sent again unasked (a payment form): recovery stops, and reload() sends it.
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

  // A crash in the background reloads once the app is back: there the reload could die the same way, unseen. The
  // driver sends the app to the background, kills the renderer and brings the app back 5 s later.
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
  // The reloaded document's start, on the same clock as Date.now(). The reload may start shortly before JS sees
  // `active` (Android's window is visible before onResume).
  const loadedAt = await h.ref.current?.evaluate('performance.timeOrigin').catch(errorCode);
  r.check(
    'a crash in the background reloads once the app is active',
    backgroundGone?.recovered === true &&
      recovered &&
      typeof loadedAt === 'number' &&
      loadedAt > activeAt - 1500,
    {
      backgroundGone,
      recovered,
      states,
      loadedAt,
      startedBeforeActive: activeAt - Number(loadedAt),
    }
  );

  // A load() while the recovery waits (the app in the background) loads on top of the history, as without a crash:
  // back goes to the page on screen at the crash. The driver backgrounds the app around the kill as above.
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
  h.setProps({ userAgent: 'Crash/1' }); // the next kill's onProcessGone loads nothing

  // A crash while the view is out of its window (under a full-screen modal) reloads once it is back in one. Android
  // keeps the window of a view under a modal, so this is iOS's case.
  if (Platform.OS === 'ios') {
    const under = fresh(h, '/bridge.html');
    await openPage(h, under);
    h.setCovered(true);
    await sleep(1000); // the presentation
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
}
