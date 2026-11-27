import { Platform } from 'react-native';
import type { NavigationState } from 'react-native-minimal-webview';

import {
  captureWarnings,
  errorCode,
  fresh,
  idle,
  openPage,
  poll,
  sleep,
  tapLink,
  text,
  travel,
  waitFor,
  waitForLoad,
  happens,
  quietFor,
} from '../harness/helpers';
import { WEBVIEW, type Harness, type Reporter } from '../harness/runner';

export async function refLoad(h: Harness, r: Reporter) {
  const home = await openPage(h, fresh(h, '/'));
  const handle = h.ref.current;
  const page = fresh(h, '/bridge.html');
  const loadPage = (url: string) =>
    happens(
      waitForLoad(
        h,
        () => h.ref.current?.load(url),
        (s) => s.url === url && idle(s)
      )
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

  await r.block('history', () => refLoadHistory(h, r));

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
  const blocked = () =>
    h.events.navigations.some((n) => n.action === 'block' && n.url.endsWith('/blocked'));
  h.ref.current?.load(redirected);
  await poll(blocked, 15000);
  await sleep(300);
  r.check("the load's redirect goes to the rules", blocked() && h.state().url === allowed, {
    navigations: h.events.navigations,
    state: h.state(),
  });
  await r.block('races', () => refLoadRaces(h, r));
  h.setRules(undefined);
  await r.block('edges', () => refLoadEdges(h, r));
}

const NAVIGATIONS = [
  ['load', (h: Harness, _r: Reporter, url: string) => h.ref.current?.load(url)],
  ['link', tapLink],
] as const;

async function refLoadHistory(h: Harness, r: Reporter) {
  const ways: Record<string, unknown> = {};
  for (const [way, go] of NAVIGATIONS) {
    const a = await openPage(h, fresh(h, `/back-forward.html?title=${way}A`));
    const b = fresh(h, `/back-forward.html?title=${way}B`);
    const arrived = await happens(
      waitForLoad(
        h,
        () => go(h, r, b),
        (s) => s.url === b && idle(s)
      )
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

async function backAfterPushState(h: Harness, a: string, b: string) {
  await h.ref.current?.evaluate("history.pushState(null, '', '#pushed')");
  await waitFor(h, (s) => s.url === `${b}#pushed`);
  h.ref.current?.goBack();
  await waitFor(h, (s) => s.url !== `${b}#pushed` && idle(s));
  await quietFor(500);
  const { url } = h.state();
  if (url === a) return 'the page before it (its entry skipped)';
  return url === b ? 'the page itself' : url;
}

const FIRST_LOADS = [
  ['a load', (h: Harness, url: string) => h.ref.current?.load(url)],
  ['a source change', (h: Harness, url: string) => h.loadSource({ uri: url })],
] as const;

async function refLoadRaces(h: Harness, r: Reporter) {
  for (const sharedCookies of [false, true]) {
    h.setProps({ sharedCookies });
    await sleep(300);
    for (const [name, first] of FIRST_LOADS) {
      const reported: unknown[] = [];
      let wrong: NavigationState | undefined;
      let run: Awaited<ReturnType<typeof loadAfter>> | undefined;
      const loadBeforeFirstPolicyCheckSamples = name === 'a load' && !sharedCookies ? 5 : 1;
      for (let i = 0; i < loadBeforeFirstPolicyCheckSamples; i++) {
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

async function loadAfter(
  h: Harness,
  name: (typeof FIRST_LOADS)[number][0],
  first: (typeof FIRST_LOADS)[number][1]
) {
  h.events.navigations.length = 0;
  const earlier = fresh(h, '/?first');
  const loaded = fresh(h, '/');
  const ended = await happens(
    waitForLoad(
      h,
      () => {
        first(h, earlier);
        if (name === 'a load') setTimeout(() => h.ref.current?.load(loaded), 0);
        else h.ref.current?.load(loaded);
      },
      (s) => [earlier, loaded].includes(s.url) && idle(s)
    )
  );
  await sleep(300);
  const reported = h.events.navigations.filter((n) => n.mainFrame);
  const wrong = !ended || (name === 'a load' && h.state().url !== loaded) ? h.state() : undefined;
  return { reported, wrong, onLoad: h.state().url === loaded };
}

async function refLoadEdges(h: Harness, r: Reporter) {
  const warnings = captureWarnings();
  r.cleanup(warnings.stop);
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
  const mounted = await happens(
    waitForLoad(
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
    )
  );
  r.check('a load as a remounted WebView attaches its ref waits for the view', mounted, h.state());
}
