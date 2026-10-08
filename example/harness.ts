// Scripted spike checks. Results go to the JS console as `[harness] PASS|FAIL|INFO ...` lines, readable from
// logcat (ReactNativeJS) or the Metro log, so no screenshots are needed.
import type { NavigationState, WebViewRef } from 'minimal-rn-webview';
import type { RefObject } from 'react';
import { Platform } from 'react-native';

export type Harness = {
  pages: string;
  platform: string;
  ref: RefObject<WebViewRef | null>;
  state: () => NavigationState;
  load: (uri: string) => void;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let current: Harness | null = null;

function emit(line: string) {
  const text = `[harness ${current?.platform}] ${line}`;
  console.log(text);
  // A failed post surfaces as an unhandled rejection; the console line above still has the result.
  void fetch(`${current?.pages}/harness/log`, { method: 'POST', body: text });
}

function reporter(suite: string) {
  let pass = 0;
  let fail = 0;
  return {
    check(name: string, ok: boolean, detail: unknown = '') {
      ok ? pass++ : fail++;
      emit(`${ok ? 'PASS' : 'FAIL'} ${suite}: ${name} ${ok ? '' : JSON.stringify(detail)}`);
    },
    info(name: string, detail: unknown) {
      emit(`INFO ${suite}: ${name} ${JSON.stringify(detail)}`);
    },
    done() {
      emit(`DONE ${suite} pass=${pass} fail=${fail}`);
    },
  };
}

/** Runs suites queued with `curl 'localhost:8090/harness/run?platform=ios&suite=<name>'`. */
export function pollForSuites(get: () => Harness) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    const name = await fetch(`${get().pages}/harness/next?platform=${Platform.OS}`).then(
      (r) => r.text(),
      (error: unknown) => {
        console.warn('[harness] poll failed', error);
        return '';
      }
    );
    if (!name) return;
    busy = true;
    current = get();
    const suite = SUITES[name];
    if (suite) await suite(current);
    else emit(`FAIL unknown suite ${name}`);
    busy = false;
  }, 1000);
  return () => clearInterval(timer);
}

async function waitFor(h: Harness, predicate: (s: NavigationState) => boolean, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate(h.state())) return true;
    await sleep(50);
  }
  return false;
}

const idle = (s: NavigationState) => !s.loading && s.pendingUrl === null;
const href = async (h: Harness) => (await h.ref.current?.evaluate('location.href')) as string;
const click = (h: Harness, id: string) =>
  h.ref.current?.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);

/** Committed url, getUrl() and the page's location.href all agree. */
async function agree(h: Harness, r: ReturnType<typeof reporter>, name: string) {
  await sleep(300); // let the coalesced state event arrive
  const page = await href(h);
  const native = await h.ref.current?.getUrl();
  const { url } = h.state();
  r.check(name, url === page && native === page, { url, getUrl: native, href: page });
}

async function urlTracking(h: Harness) {
  const r = reporter('urlTracking');
  h.load(`${h.pages}/spa.html?t=${Date.now()}`);
  r.check(
    'initial load',
    await waitFor(h, (s) => s.url.includes('/spa.html') && idle(s)),
    h.state()
  );
  await agree(h, r, 'initial load agrees');

  for (const [id, expected] of [
    ['push', '/spa/pushed'],
    ['replace', '/spa/replaced'],
    ['hash', '#h'],
  ] as const) {
    await click(h, id);
    r.check(
      `${id} updates url`,
      await waitFor(h, (s) => s.url.includes(expected), 3000),
      h.state()
    );
    await agree(h, r, `${id} agrees`);
  }
  const beforeBack = h.state().url;
  await click(h, 'back');
  r.check(
    'history.back updates url',
    await waitFor(h, (s) => s.url !== beforeBack, 3000),
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
      await waitFor(h, (s) => s.url.includes(expected) && idle(s)),
      h.state()
    );
    await agree(h, r, `${id} agrees`);
  }

  // 5.2: what url and pendingUrl show while a slow navigation is in flight
  const beforeSlow = h.state().url;
  await h.ref.current?.evaluate(`location.href = '/slow?ms=3000'`);
  await sleep(1000);
  const during = h.state();
  r.info('during slow load', {
    url: during.url,
    pendingUrl: during.pendingUrl,
    loading: during.loading,
  });
  r.check('url keeps the committed page while loading', during.url === beforeSlow, during);
  r.check(
    'pendingUrl shows the in-flight url',
    (during.pendingUrl ?? '').includes('/slow'),
    during
  );
  r.check(
    'slow load commits',
    await waitFor(h, (s) => s.url.includes('/slow') && idle(s)),
    h.state()
  );
  await agree(h, r, 'slow load agrees');
  r.done();
}

async function realSite(h: Harness) {
  const r = reporter('realSite');
  h.load('https://www.delfi.ee/');
  r.check(
    'delfi loads',
    await waitFor(h, (s) => s.url.includes('delfi.ee') && idle(s), 30000),
    h.state()
  );
  await agree(h, r, 'home agrees');
  for (let i = 0; i < 3; i++) {
    const before = h.state().url;
    // Click an internal article link so the Nuxt router navigates client-side.
    const target = await h.ref.current?.evaluate(`(() => {
      const a = [...document.querySelectorAll('a[href]')].find((a) => a.origin === location.origin && /\\/\\d{6,}/.test(a.pathname) && a.pathname !== location.pathname && !a.hash);
      if (!a) return null;
      a.click();
      return a.href;
    })()`);
    r.info(`click ${i}`, target);
    if (!target) break;
    r.check(
      `article ${i} changes url`,
      await waitFor(h, (s) => s.url !== before, 15000),
      h.state()
    );
    await waitFor(h, idle, 15000);
    await sleep(1500);
    await agree(h, r, `article ${i} agrees`);
  }
  h.ref.current?.goBack();
  await sleep(2500);
  await agree(h, r, 'goBack agrees');
  r.done();
}

export const SUITES: Record<string, (h: Harness) => Promise<void>> = { urlTracking, realSite };
