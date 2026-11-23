import type { NavigationState } from 'react-native-minimal-webview';

import {
  click,
  errorCode,
  fresh,
  idle,
  sleep,
  text,
  until,
  waitFor,
  poll,
  happens,
  tap,
} from '../harness/helpers';
import { WEBVIEW, type Harness, type Reporter } from '../harness/runner';

const href = async (h: Harness) => (await h.ref.current?.evaluate('location.href')) as string;

async function agree(h: Harness, r: Reporter, name: string) {
  let seen = {};
  const agreed = await poll(
    async () => {
      const page = await href(h);
      const { url } = h.state();
      seen = { url, href: page };
      return url === page;
    },
    2000,
    50
  );
  r.check(name, agreed === true, seen);
}

export async function urlTracking(h: Harness, r: Reporter) {
  const first = fresh(h, '/spa.html');
  const loadsBefore = h.events.loads.length;
  h.load(first);
  let early: NavigationState | null = null;
  for (
    const end = Date.now() + 10000;
    Date.now() < end && !h.events.loads.slice(loadsBefore).includes('start');
  ) {
    const s = h.state();
    if (s.url === first && idle(s)) early = s;
    await sleep(10);
  }
  r.check('a new source is not reported loaded before it starts', early === null, early);
  r.check('initial load', await happens(waitFor(h, (s) => s.url === first && idle(s))), h.state());
  await agree(h, r, 'initial load agrees');

  for (const [id, expected] of [
    ['push', '/spa/pushed'],
    ['replace', '/spa/replaced'],
    ['hash', '#h'],
  ] as const) {
    await click(h, id);
    r.check(
      `${id} updates url`,
      await happens(waitFor(h, (s) => s.url.includes(expected), 3000)),
      h.state()
    );
    await agree(h, r, `${id} agrees`);
  }
  const beforeBack = h.state().url;
  await click(h, 'back');
  r.check(
    'history.back updates url',
    await happens(waitFor(h, (s) => s.url !== beforeBack, 3000)),
    h.state()
  );
  await agree(h, r, 'history.back agrees');

  const beforeFrame = h.state().url;
  await click(h, 'frame-push');
  await sleep(1000);
  r.check('iframe pushState leaves url alone', h.state().url === beforeFrame, h.state());

  for (const [id, expected] of [
    ['redirect', 'from=redirect'],
    ['redirect301', 'from=301'],
    ['chain', 'from=chain'],
  ] as const) {
    await click(h, id);
    r.check(
      `${id} lands on the final url`,
      await happens(waitFor(h, (s) => s.url.includes(expected) && idle(s))),
      h.state()
    );
    await agree(h, r, `${id} agrees`);
  }

  const beforeSlow = h.state().url;
  await h.ref.current?.evaluate(`location.href = '/slow?ms=3000'`);
  await poll(() => (h.state().pendingUrl ?? '').includes('/slow'), 1000, 50);
  const during = h.state();
  r.info('during slow load', {
    url: during.url,
    pendingUrl: during.pendingUrl,
    loading: during.loading,
  });
  r.check('url keeps the committed page while loading', during.url === beforeSlow, during);
  r.since(
    WEBVIEW.navigationListener,
    'pendingUrl shows the in-flight url',
    (during.pendingUrl ?? '').includes('/slow'),
    during
  );
  r.check(
    'slow load commits',
    await happens(waitFor(h, (s) => s.url.includes('/slow') && idle(s))),
    h.state()
  );
  await agree(h, r, 'slow load agrees');

  await h.ref.current?.evaluate(`location.href = '/slow-image.html?t=${Date.now()}'`);
  await until(async () => (await text(h, 'old').catch(errorCode)) === 'old', 5000);
  const leaving = h.events.loads.length;
  await h.ref.current?.evaluate(`location.href = '/slow?ms=3000'`);
  await sleep(2500);
  r.check(
    "the page being left doesn't end the pending load",
    h.state().loading && !h.events.loads.slice(leaving).includes('end'),
    { state: h.state(), loads: h.events.loads.slice(leaving) }
  );
  await waitFor(h, (s) => s.url.includes('/slow') && idle(s));

  const beforeRemount = h.state().url;
  h.remount();
  await sleep(0);
  r.check('a remount resets the state', h.state().url !== beforeRemount, h.state());
  r.check(
    'useWebViewState follows the remounted WebView',
    await happens(waitFor(h, (s) => s.url === first && idle(s))),
    h.state()
  );
  r.check('getState() is the same state', h.ref.getState() === h.state(), h.ref.getState());
  await agree(h, r, 'remounted WebView agrees');

  const backBefore = h.state().canGoBack;
  // A gesture: Chromium's canGoBack skips an entry that a page added without one.
  await tap(h, r, 'frame-push');
  r.check(
    'iframe pushState in a new WebView lets it go back',
    !backBefore && (await happens(waitFor(h, (s) => s.canGoBack, 3000))),
    { backBefore, state: h.state() }
  );
}
