import { Platform } from 'react-native';
import type {
  NavigationRule,
  NavigationState,
  WebViewProps,
  WebViewSource,
} from 'react-native-minimal-webview';

import { WEBVIEW, type Harness, type HarnessProps, type Reporter } from './runner';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits `ms`, long enough for an event that must not come to have arrived, so the check after it would see one. */
export const quietFor = sleep;
export const waitForPresentation = () => sleep(1000);

export class Timeout extends Error {}

/** Whether `wait` came in time: false when it threw a Timeout. For a wait whose outcome is the check. */
export const happens = (wait: Promise<unknown>) =>
  wait.then(
    () => true,
    (error: unknown) => {
      if (error instanceof Timeout) return false;
      throw error;
    }
  );

/**
 * Polls `fn` until it returns something truthy, and returns that; undefined when a call made after `ms` still returns
 * nothing truthy.
 */
export async function poll<T>(
  fn: () => T | Promise<T>,
  ms = 10000,
  step = 100
): Promise<T | undefined> {
  for (const end = Date.now() + ms; ; await sleep(step)) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= end) return undefined;
  }
}

/** Collects each `console.warn` line (the WebView's warnings among them) until `stop` restores `console.warn`. */
export function captureWarnings() {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
    warn(...args);
  };
  return {
    lines,
    warned: (text: string) => lines.some((line) => line.includes(text)),
    stop: () => {
      console.warn = warn;
    },
  };
}

/** As `poll`, but throws a Timeout after `ms`: a suite goes on only once `fn` returned something truthy. */
export async function until<T>(fn: () => T | Promise<T>, ms = 10000, step = 100) {
  const value = await poll(fn, ms, step);
  if (!value) throw new Timeout(`nothing came in ${ms} ms`);
  return value;
}

/** Waits until the navigation state passes `predicate`; throws a Timeout, with the state, after `ms`. */
export async function waitFor(
  h: Pick<Harness, 'state'>,
  predicate: (s: NavigationState) => boolean,
  ms = 10000
) {
  if (!(await poll(() => predicate(h.state()), ms, 50)))
    throw new Timeout(`the state after ${ms} ms: ${JSON.stringify(h.state())}`);
}

export const idle = (s: NavigationState) => !s.loading && s.pendingUrl === null;

/** The native key the `userAgent` prop sets. */
export const USER_AGENT_KEY =
  Platform.OS === 'ios' ? 'webView.customUserAgent' : 'settings.userAgentString';

/**
 * Runs `act`, then waits for a load that ends after it (onLoadEnd) and for `done`, by default the idle page: throws a
 * Timeout unless both came within `ms`.
 */
export async function waitForLoad(
  h: Harness,
  act: () => unknown,
  done: (s: NavigationState) => boolean = idle,
  ms = 15000
) {
  const loads = h.events.loads.length;
  await act();
  await waitFor(h, (s) => h.events.loads.slice(loads).includes('end') && done(s), ms);
}

/**
 * For a request handler that never settles: `never(signal)` is its pending answer, and `stuck` says when its signal
 * aborted (`abortedAt`, 0 until then) and answers it (`release`).
 */
export function stuckHandler<T>() {
  const stuck = { abortedAt: 0, release: (_value: T) => {} };
  const never = (signal: AbortSignal) => {
    signal.addEventListener('abort', () => (stuck.abortedAt = Date.now()));
    return new Promise<T>((resolve) => (stuck.release = resolve));
  };
  return { stuck, never };
}

/** Checks that a request whose handler never settles reached JS: one more than `before`, by what `seen` counts. */
export async function reachesJs(r: Reporter, seen: () => number, before: number) {
  await poll(() => seen() > before, 10000, 200);
  r.check(
    'a request whose handler never settles reaches JS',
    seen() === before + 1,
    seen() - before
  );
}

/** An `onOpenExternal` that records each URL in `into` and answers that the app opened it. */
export const recordExternal =
  (into: string[]): WebViewProps['onOpenExternal'] =>
  ({ url }) => {
    into.push(url);
    return true;
  };
/** Allows every `ask`, with `rules` ahead of a catch-all http(s) allow; returns the asked URLs. */
export const allowAsks = async (h: Harness, rules: NavigationRule[]) => {
  const asked: string[] = [];
  h.setAsk((request) => {
    asked.push(request.url);
    return 'allow';
  });
  h.setRules([...rules, { scheme: ['http', 'https'], action: 'allow' }]);
  await sleep(300);
  return asked;
};
/** The height of a 100vh element: 0 when the WebView loaded the page before it had a size. */
export const viewportHeight = async (h: Harness) =>
  (await h.ref.current?.evaluate(
    `(() => { const d = document.createElement('div'); d.style.height = '100vh'; document.body.append(d); const v = d.offsetHeight; d.remove(); return v; })()`
  )) as number;
/** A click from script on `id`; with `frame`, on an element in that same-origin iframe. */
export const click = (h: Harness, id: string, frame?: string) =>
  h.ref.current?.evaluate(
    `${frame ? `document.getElementById(${JSON.stringify(frame)}).contentDocument` : 'document'}.getElementById(${JSON.stringify(id)}).click()`
  );

/**
 * A click from script on `id` that returns before the click runs and is not awaited: on iOS, evaluate does not return
 * while a dialog blocks the page.
 */
export const clickWithoutWaiting = (h: Harness, id: string) =>
  void h.ref.current?.evaluate(
    `setTimeout(() => document.getElementById(${JSON.stringify(id)}).click(), 0)`
  );

/**
 * Runs `act`, then waits for the first entry that `log` gains after it and `match` accepts: that entry, or undefined
 * after `ms`.
 */
export async function nextEntry<T>(
  log: T[],
  act: () => unknown,
  match: (entry: T) => boolean = () => true,
  ms = 3000
) {
  const before = log.length;
  await act();
  return await poll(() => log.slice(before).find(match), ms);
}

/** Whether the page's `location.href` comes to equal the state's url within 2 s. */
export const agrees = async (h: Harness) =>
  (await poll(
    async () => (await h.ref.current?.evaluate('location.href').catch(String)) === h.state().url,
    2000,
    50
  )) === true;

export const errorCode = (error: unknown) => (error as { code?: string }).code;

/**
 * Starts a page-side `nativeBridge.call` whose outcome the page puts in `window.__call`: undefined once started, or
 * the error code when it can't start (`script_error` on a page without the bridge).
 */
export function startPageCall(h: Harness, method: string, params: unknown) {
  const start = `(() => {
    window.__call = undefined;
    nativeBridge.call(${JSON.stringify(method)}, ${JSON.stringify(params)}).then(
      (result) => (window.__call = { result }),
      (error) => (window.__call = { error: error.code })
    );
  })()`;
  return h.ref.current?.evaluate(start).then(() => undefined, errorCode);
}

/** Starts a page-side `nativeBridge.call` and waits for its outcome; `script_error` on a page without the bridge. */
export async function pageCall(h: Harness, method: string, params: unknown) {
  const error = await startPageCall(h, method, params);
  if (error) return { error };
  const outcome = await poll(() => h.ref.current?.evaluate('window.__call'), 6000, 100);
  return (outcome ?? { error: 'harness timeout' }) as { result?: unknown; error?: string };
}

/** Empties the event logs, except `downloads`: `reset()` deletes the files it lists. */
export const clearEvents = (h: Harness) => {
  for (const [name, log] of Object.entries(h.events))
    if (Array.isArray(log) && name !== 'downloads') log.length = 0;
  h.pageEvents.length = 0;
};

/** A test page's URL with a cache-buster: `path` on the test pages server, or a full URL. */
export const fresh = (h: Harness, path: string) =>
  `${path.startsWith('http') ? '' : h.pages}${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}`;

/**
 * Sets props that recreate the WebView (a creation-time setting) and waits until the new one has loaded its page. With
 * `remount`, it remounts too, for props that don't recreate it, such as an `extensions` entry whose hook attaches
 * only when a WebView is created.
 */
export async function recreate(
  h: Harness,
  props: HarnessProps,
  { remount = false }: { remount?: boolean } = {}
) {
  await waitForLoad(h, () => {
    h.setProps(props);
    if (remount) h.remount();
  });
}

const EVENTS_AFTER_LOAD_END_MS = 100;

/**
 * Loads `page`, a URL or a source with one, and waits until it is the idle page and its load has ended. Returns its
 * URL.
 */
export async function openPage(
  h: Harness,
  page: string | Extract<WebViewSource, { uri: string }>,
  ms = 15000
) {
  const source = typeof page === 'string' ? { uri: page } : page;
  await waitForLoad(
    h,
    () => h.loadSource(source),
    (s) => s.url === source.uri && idle(s),
    ms
  );
  await sleep(EVENTS_AFTER_LOAD_END_MS);
  return source.uri;
}

/** Runs `act`, then waits for the lines the page adds to `window.testLog`; null when none come within `ms`. */
export async function pageLog(h: Harness, act: () => unknown, ms = 10000) {
  const before = ((await h.ref.current?.evaluate('window.testLog.length')) as number) ?? 0;
  await act();
  return (
    (await poll(async () => {
      const lines = await h.ref.current
        ?.evaluate(`(window.testLog ?? []).slice(${before})`)
        .catch(String);
      return Array.isArray(lines) && lines.length ? (lines as string[]) : undefined;
    }, ms)) ?? null
  );
}

/** An element's text, '' when it is missing. */
export const text = async (h: Harness, id: string) =>
  (await h.ref.current?.evaluate(
    `document.getElementById(${JSON.stringify(id)})?.textContent ?? ''`
  )) as string;

/**
 * The screen point of an element's centre, `x, y`, for a driver's tap: pixels on Android, points on iOS; with `frame`,
 * of an element inside that same-origin iframe. On iOS WebKit starts the page below the part of the WebView that is
 * under the status bar, so innerHeight falls short of the WebView's height by that much (nothing covers its bottom).
 */
export const tapPoint = async (h: Harness, id: string, frame?: string) =>
  (
    (await h.ref.current?.evaluate(`(() => {
    const f = ${frame ? `document.getElementById(${JSON.stringify(frame)})` : 'null'};
    const e = (f ? f.contentDocument : document).getElementById(${JSON.stringify(id)});
    (f ?? e).scrollIntoView({ block: 'center' });
    const fr = f?.getBoundingClientRect(), x = fr ? fr.left + f.clientLeft : 0, y = fr ? fr.top + f.clientTop : 0;
    const b = e.getBoundingClientRect(), d = ${Platform.OS === 'android' ? 'devicePixelRatio' : 1};
    const top = ${Platform.OS === 'android' ? 0 : `Math.max(0, ${h.webViewOffset.height} - innerHeight)`};
    return [
      Math.round((${h.webViewOffset.x} + x + b.left + b.width / 2) * d),
      Math.round((${h.webViewOffset.y} + top + y + b.top + b.height / 2) * d),
    ];
  })()`)) as [number, number]
  ).join(', ');

/**
 * A user gesture on `id` (with `frame`, on an element in that same-origin iframe): the driver's real tap on Android,
 * asked for with a `tap` request; a click from script on iOS, which WebKit runs as a gesture but the core doesn't count
 * as `userInitiated`. A click on a page that went away shows in the check that follows.
 */
export async function tap(h: Harness, r: Reporter, id: string, frame?: string) {
  if (Platform.OS === 'android') r.drive({ action: 'tap', point: await tapPoint(h, id, frame) });
  else await click(h, id, frame)?.catch(errorCode);
}

/**
 * The driver's real tap on `id` (with `frame`, on an element in that same-origin iframe), asked for with a `tap`
 * request. A check that needs `userInitiated` uses it on iOS too, where the core counts a link only after a touch.
 */
export async function touch(h: Harness, r: Reporter, id: string, frame?: string) {
  r.drive({ action: 'tap', point: await tapPoint(h, id, frame) });
}

/**
 * Goes back or forward (`go`) to `url`, titled `title`, with an entry after it when `back`: checks that it comes from the
 * back-forward cache with one finished load and a working bridge. Returns what a way to build the history changes.
 */
export async function travel(
  h: Harness,
  r: Reporter,
  name: string,
  go: () => void,
  url: string,
  title: string,
  back: boolean
) {
  clearEvents(h);
  go();
  await waitFor(h, (s) => s.url === url && idle(s));
  await quietFor(500);
  const shows = (await h.ref.current?.evaluate('window.shows')) as boolean[] | undefined;
  r.since(
    WEBVIEW.navigationListener,
    `${name}: the page is restored from the cache`,
    shows?.[1] === true,
    shows
  );
  const s = h.state();
  r.check(
    `${name}: the state is the restored page's`,
    s.url === url && s.title === title && s.canGoBack && s.canGoForward === back,
    s
  );
  r.check(
    `${name}: one load start and end, finished`,
    JSON.stringify(h.events.loads) === '["start","end"]' &&
      JSON.stringify(h.events.outcomes) === '["finished"]',
    { loads: h.events.loads, outcomes: h.events.outcomes }
  );
  const sum = await h.bridge.call('sum', { a: 2, b: 3 }).catch(errorCode);
  r.since(WEBVIEW.bridge, `${name}: RN -> page call`, sum === 5, sum);
  h.bridge.emit('nativeEvent', { n: 7 });
  await poll(
    async () =>
      ((await h.ref.current?.evaluate('window.lastEvent')) as { n?: number } | null)?.n === 7,
    3000
  );
  const event = await h.ref.current?.evaluate('window.lastEvent');
  r.since(
    WEBVIEW.bridge,
    `${name}: RN -> page event`,
    (event as { n?: number } | null)?.n === 7,
    event
  );
  await h.ref.current?.evaluate('window.lastEvent = null');
  const echo = await pageCall(h, 'echo', { url });
  r.since(
    WEBVIEW.bridge,
    `${name}: page -> RN call`,
    (echo.result as { url?: string } | undefined)?.url === url,
    echo
  );
  return { shows, canGoBack: s.canGoBack, canGoForward: s.canGoForward };
}
