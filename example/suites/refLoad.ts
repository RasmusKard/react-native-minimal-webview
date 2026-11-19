import { Platform } from 'react-native';
import type { NavigationState } from 'react-native-minimal-webview';

import {
  captureWarnings,
  errorCode,
  fresh,
  idle,
  openPage,
  sleep,
  tap,
  text,
  travel,
  waitFor,
  waitForLoad,
} from '../harness/helpers';
import { WEBVIEW, reporter, type Harness } from '../harness/runner';

/**
 * The ref's `load`: in place (same handle, the bridge carries on), a history entry that back, forward and the
 * back-forward cache treat as a tapped link's, no dedupe, past rules that block every navigation (its redirect still
 * goes to them) also when a load or a source change came in the same tick, `source` and reload left as they were, and a
 * load from the moment a remounted WebView attaches its ref (on iOS while its `source` waits for the shared cookies).
 */
export async function refLoad(h: Harness) {
  const r = reporter('refLoad');
  const home = fresh(h, '/');
  await openPage(h, home);
  const handle = h.ref.current;
  const page = fresh(h, '/bridge.html');
  const loadPage = (url: string) =>
    waitForLoad(
      h,
      () => h.ref.current?.load(url),
      (s) => s.url === url && idle(s)
    );
  const historyLength = async () => (await h.ref.current?.evaluate('history.length')) as number;
  const entries = await historyLength();
  r.check('load loads the URL', await loadPage(page), h.state());
  r.check('the same WebView, not a remount', h.ref.current === handle);
  const added = (await historyLength()) - entries;
  r.check('as a new history entry', added === 1 && h.state().canGoBack, {
    added,
    state: h.state(),
  });
  r.since(
    WEBVIEW.bridge,
    'the bridge works on the loaded page',
    (await h.bridge.call('sum', { a: 1, b: 2 }).catch(errorCode)) === 3
  );

  await h.ref.current?.evaluate('window.__mark = 1');
  const loads = h.events.loads.length;
  const again = await loadPage(page);
  r.check(
    'loading the page on screen loads it again',
    again && (await h.ref.current?.evaluate('window.__mark ?? null')) === null,
    { loads: h.events.loads.slice(loads) }
  );
  const same = (await historyLength()) - entries - 1;
  r.check('loading the page on screen adds no history entry', same === 0, same);

  const inFlight = h.bridge.call('pageSlow').catch(errorCode);
  await sleep(200);
  await loadPage(fresh(h, '/bridge.html'));
  r.since(
    WEBVIEW.bridge,
    'a load rejects the bridge calls in flight',
    (await inFlight) === 'navigated'
  );

  // App's `source` is still `home`: the same one again loads nothing, and reload reloads the loaded page.
  const shown = h.state().url;
  const before = h.events.loads.length;
  h.loadSource({ uri: home });
  await sleep(1000);
  r.check(
    'a re-render with the same source loads nothing',
    h.events.loads.length === before && h.state().url === shown,
    { loads: h.events.loads.slice(before), state: h.state() }
  );
  await h.ref.current?.evaluate('window.__mark = 1');
  await waitForLoad(h, () => h.ref.current?.reload());
  r.check(
    "reload reloads the loaded page, not the source's",
    h.state().url === shown && (await h.ref.current?.evaluate('window.__mark ?? null')) === null,
    h.state()
  );

  await refLoadHistory(h, r);

  h.setRules([]);
  await sleep(300);
  h.events.navigations.length = 0;
  const allowed = fresh(h, '/');
  r.check('load skips rules that block every navigation', await loadPage(allowed), h.state());
  await sleep(300);
  r.check(
    'a load is not reported to onNavigation',
    h.events.navigations.length === 0,
    h.events.navigations
  );
  const redirected = `${h.pages}/redirect?to=/blocked`;
  await waitForLoad(h, () => h.ref.current?.load(redirected));
  await sleep(300);
  r.check(
    "the load's redirect goes to the rules",
    h.events.navigations.some((n) => n.action === 'block' && n.url.endsWith('/blocked')) &&
      h.state().url === allowed,
    { navigations: h.events.navigations, state: h.state() }
  );
  await refLoadRaces(h, r);
  h.setRules(undefined);
  await refLoadEdges(h, r);
  r.done();
}

/** Two ways to go to `url` from a page: the app's load, and a tap on a link (a click from script on iOS, see `tap`). */
const NAVIGATIONS = [
  ['load', (h: Harness, _r: ReturnType<typeof reporter>, url: string) => h.ref.current?.load(url)],
  [
    'link',
    async (h: Harness, r: ReturnType<typeof reporter>, url: string) => {
      await h.ref.current?.evaluate(`(() => {
        document.getElementById('link')?.remove();
        const a = Object.assign(document.createElement('a'), { id: 'link', href: ${JSON.stringify(url)}, textContent: 'link' });
        a.style.cssText = 'display: block; padding: 24px; font-size: 32px';
        document.body.append(a);
      })()`);
      await tap(h, r, 'link');
    },
  ],
] as const;

/**
 * The same history built with a load and with a tapped link: back and forward come from the back-forward cache alike,
 * and `goBack` lands alike after the page's `pushState` without a gesture (Android skips such an entry). The referrer
 * and the headers a load sends instead of a link's are only logged.
 */
async function refLoadHistory(h: Harness, r: ReturnType<typeof reporter>) {
  const ways: Record<string, unknown> = {};
  for (const [way, go] of NAVIGATIONS) {
    const a = fresh(h, `/back-forward.html?title=${way}A`);
    await openPage(h, a);
    const b = fresh(h, `/back-forward.html?title=${way}B`);
    const arrived = await waitForLoad(
      h,
      () => go(h, r, b),
      (s) => s.url === b && idle(s)
    );
    r.check(`${way}: goes to the page`, arrived && h.state().canGoBack, h.state());
    const back = await travel(
      h,
      r,
      `${way}: back`,
      () => h.ref.current?.goBack(),
      a,
      `${way}A`,
      true
    );
    const forward = await travel(
      h,
      r,
      `${way}: forward`,
      () => h.ref.current?.goForward(),
      b,
      `${way}B`,
      false
    );
    const pushed = await backAfterPushState(h, a, b);
    const lands =
      Platform.OS === 'android' ? 'the page before it (its entry skipped)' : 'the page itself';
    r.check(
      `${way}: goBack after the page's pushState without a gesture lands on ${lands}`,
      pushed === lands,
      pushed
    );
    ways[way] = { back, forward, pushed };
    const headers = fresh(h, '/headers');
    await waitForLoad(
      h,
      () => go(h, r, headers),
      (s) => s.url === headers && idle(s)
    );
    const sent = JSON.parse((await text(h, 'headers')) || '{}') as Record<string, string>;
    r.info(`${way}: referrer and request headers`, {
      referrer: await h.ref.current?.evaluate('document.referrer'),
      referer: sent.referer,
      secFetchSite: sent['sec-fetch-site'],
      secFetchUser: sent['sec-fetch-user'],
    });
  }
  r.check(
    'a load and a tapped link restore, travel and go back alike',
    JSON.stringify(ways.load) === JSON.stringify(ways.link),
    ways
  );
}

/** On page `b`, after page `a`: pushes an entry without a gesture, goes back, and says where that lands. */
async function backAfterPushState(h: Harness, a: string, b: string) {
  await h.ref.current?.evaluate("history.pushState(null, '', '#pushed')");
  await waitFor(h, (s) => s.url === `${b}#pushed`);
  h.ref.current?.goBack();
  await waitFor(h, (s) => s.url !== `${b}#pushed` && idle(s));
  await sleep(500); // a load the back starts late would show now
  const { url } = h.state();
  if (url === a) return 'the page before it (its entry skipped)';
  return url === b ? 'the page itself' : url;
}

/** How the first of two app loads in a row starts: a load (the second follows in a 0 ms timeout) or a source change. */
const FIRST_LOADS = [
  ['a load', (h: Harness, url: string) => h.ref.current?.load(url)],
  ['a source change', (h: Harness, url: string) => h.loadSource({ uri: url })],
] as const;

/**
 * A load right after another load or a source change: on iOS without sharedCookies it starts before the first one's
 * policy check (a single own-load slot let that check go to the rules); with them it replaces the
 * first while that is prepared. In the same tick as a source change, which one ends on screen is only logged: the
 * TSDoc leaves it open.
 */
async function refLoadRaces(h: Harness, r: ReturnType<typeof reporter>) {
  for (const sharedCookies of [false, true]) {
    h.setProps({ sharedCookies });
    await sleep(300);
    for (const [name, first] of FIRST_LOADS) {
      const reported: unknown[] = [];
      let wrong: NavigationState | undefined;
      let run: Awaited<ReturnType<typeof loadAfter>> | undefined;
      const tries = name === 'a load' && !sharedCookies ? 5 : 1;
      for (let i = 0; i < tries; i++) {
        run = await loadAfter(h, name, first);
        reported.push(...run.reported);
        wrong ??= run.wrong;
      }
      if (name === 'a source change')
        r.info(
          `on screen after a source change and a load in the same tick (sharedCookies ${sharedCookies})`,
          run?.onLoad ? 'the load' : 'the source'
        );
      r.check(
        `neither ${name} nor a load right after it goes to the rules (sharedCookies ${sharedCookies})`,
        reported.length === 0 && !wrong,
        { reported, wrong }
      );
    }
  }
  h.setProps({});
}

/** Starts `first`, then a load right after it: the main-frame navigations reported, and the state if it went wrong. */
async function loadAfter(
  h: Harness,
  name: (typeof FIRST_LOADS)[number][0],
  first: (typeof FIRST_LOADS)[number][1]
) {
  h.events.navigations.length = 0;
  const earlier = fresh(h, '/?first');
  const loaded = fresh(h, '/');
  const ended = await waitForLoad(
    h,
    () => {
      first(h, earlier);
      if (name === 'a load') setTimeout(() => h.ref.current?.load(loaded), 0);
      else h.ref.current?.load(loaded);
    },
    (s) => [earlier, loaded].includes(s.url) && idle(s)
  );
  await sleep(300);
  const reported = h.events.navigations.filter((n) => n.mainFrame);
  const wrong = !ended || (name === 'a load' && h.state().url !== loaded) ? h.state() : undefined;
  return { reported, wrong, onLoad: h.state().url === loaded };
}

/** What `load` refuses or can't load, and a load as a remounted WebView attaches its ref. */
async function refLoadEdges(h: Harness, r: ReturnType<typeof reporter>) {
  const warnings = captureWarnings();
  const quiet = h.events.loads.length;
  // eslint-disable-next-line no-script-url -- because load must refuse it
  h.ref.current?.load(`javascript:document.title = 'ran'`);
  await sleep(500);
  warnings.stop();
  r.check(
    'a javascript: URL loads and runs nothing, with a warning',
    h.events.loads.length === quiet &&
      h.state().title !== 'ran' &&
      warnings.warned('load: a javascript: URL'),
    { loads: h.events.loads.slice(quiet), title: h.state().title, warnings: warnings.lines }
  );

  const outcomes = h.events.outcomes.length;
  await waitForLoad(h, () => h.ref.current?.load('minimal-webview-unknown:page'));
  r.check(
    'a URL the platform cannot load ends as failed',
    h.events.outcomes[outcomes] === 'failed',
    { outcomes: h.events.outcomes.slice(outcomes), errors: h.events.errors }
  );

  const early = fresh(h, '/bridge.html');
  const old = h.ref.current;
  const mounted = await waitForLoad(
    h,
    () => {
      const stop = h.ref.subscribe(() => {
        const next = h.ref.current;
        if (!next || next === old) return;
        stop();
        next.load(early);
      });
      h.remount();
    },
    (s) => s.url === early && idle(s)
  );
  r.check('a load as a remounted WebView attaches its ref waits for the view', mounted, h.state());
}
