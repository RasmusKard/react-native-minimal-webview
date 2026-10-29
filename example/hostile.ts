// The `hostile` suite: the package's security boundaries against a hostile page, each check asserting that a boundary
// holds. The page is test-pages/hostile.html, on the allowed origin (localhost:8090), on another one (127.0.0.1:8090),
// and over https with a self-signed certificate (localhost:8443).
import { Directory, File, Paths } from 'expo-file-system';
import type { BridgeSender, Download, DownloadFailure } from 'minimal-rn-webview';
import { Platform } from 'react-native';

import {
  type Harness,
  WEBVIEW,
  fresh,
  idle,
  openPage,
  reporter,
  sleep,
  tapPoint,
  until,
  waitFor,
} from './harness';
import { all } from './shapes';

const OTHER = 'http://127.0.0.1:8090';
const HTTPS = 'https://localhost:8443';

type Suite = { h: Harness; r: ReturnType<typeof reporter>; android: boolean };
/** What a probe frame of hostile.html reports to its parent. */
type FrameReport = {
  from: string;
  nativeBridge: string;
  transport: string;
  webkit: string;
  injected: string | null;
};

const errorCode = (error: unknown) => (error as { code?: string }).code;
/** The script's value, or the error code it rejected with. */
const evaluate = async (h: Harness, script: string) =>
  await h.ref.current?.evaluate(script).catch(errorCode);

/**
 * A user gesture on `id`: the driver's real tap on Android, a click from script on iOS (WebKit counts it as one).
 * Whether the page saw the click.
 */
async function gesture({ h, r, android }: Suite, id: string) {
  const before = Number(await evaluate(h, 'window.testLog.length'));
  if (android) r.info('TAP', await tapPoint(h, id));
  else await evaluate(h, `(document.getElementById(${JSON.stringify(id)}).click(), 1)`);
  const seen = async () =>
    String(await evaluate(h, `window.testLog.slice(${before}).join()`)).includes(`click ${id}`);
  return (await until(seen, 15000)) === true;
}

/**
 * T2, T3: an iframe (same-origin or not) and a main frame outside allowedOrigins get no bridge, and the messages they
 * forge through the platform transport reach no handler. F2: a script scoped to the app's origin doesn't run there.
 * F3: an evaluate a page
 * holds pending.
 */
async function bridgeGate({ h, r }: Suite) {
  const probes: { params: unknown; sender: BridgeSender }[] = [];
  const events: unknown[] = [];
  const unhandle = h.bridge.handle('hostileProbe', (params, sender) => {
    probes.push({ params, sender });
    return 'ok';
  });
  const unlisten = h.bridge.on('hostileEvent', (payload) => events.push(payload));
  try {
    h.setProps({
      injectedScripts: [
        {
          code: 'function __hostileScoped() {}\nwindow.__hostileInjected = location.origin;',
          allFrames: true,
          origins: [h.pages],
        },
      ],
    });
    await sleep(300);
    await openPage(h, fresh(h, '/hostile.html?frames=1'));
    const reports = await until(async () => {
      const value = (await evaluate(h, 'frameReports')) as FrameReport[] | undefined;
      return Array.isArray(value) && value.length >= 2 ? value : undefined;
    });
    await sleep(1000); // a forged message that got through would have reached a handler by now
    const leaked = { probes: probes.splice(0), events: events.splice(0) };
    const frame = (name: string) => reports?.find((report) => report.from === name);
    for (const name of ['cross', 'same']) {
      r.since(
        WEBVIEW.bridge,
        `T3 a ${name}-origin iframe gets no bridge, and what it forges reaches no handler`,
        all(
          frame(name)?.nativeBridge === 'undefined',
          leaked.probes.length === 0,
          leaked.events.length === 0
        ),
        { report: frame(name), leaked }
      );
    }
    r.info('T3 bridge transports the iframes found', reports);
    // The control: the main frame's own call arrives, with its origin, and the forged `ready`s took nothing over.
    const control = await evaluate(h, "nativeBridge.call('hostileProbe', { from: 'main' })");
    const sum = await h.bridge.call('sum', { a: 2, b: 3 }).catch(errorCode);
    r.since(
      WEBVIEW.bridge,
      "T3 control: the main frame's call arrives with its origin, and RN -> page still works",
      all(control === 'ok', probes.length === 1, probes[0]?.sender.origin === h.pages, sum === 5),
      { control, probes, sum }
    );

    probes.length = 0;
    await openPage(h, fresh(h, `${OTHER}/hostile.html?probe=1`));
    await sleep(1000);
    const probe = (await evaluate(h, '__probe')) as FrameReport | undefined;
    r.since(
      WEBVIEW.bridge,
      'T2 a main frame outside allowedOrigins gets no bridge, and what it forges reaches no handler',
      all(probe?.nativeBridge === 'undefined', probes.length === 0, events.length === 0),
      { probe, probes, events }
    );
    r.info('T2 bridge transports on the non-allowed main frame', probe);

    const injected = (await evaluate(
      h,
      '[window.__hostileInjected ?? null, typeof __hostileScoped]'
    )) as unknown[] | undefined;
    r.since(
      WEBVIEW.injectedScripts,
      "F2 a script scoped to the app's origin skips a non-allowed main frame and (allFrames) cross-origin iframes, leaving no function there",
      all(
        injected?.[0] === null,
        injected?.[1] === 'undefined',
        frame('cross')?.injected === null,
        frame('same')?.injected === h.pages
      ),
      { injected, cross: frame('cross'), same: frame('same') }
    );

    // A page can hold an evaluate pending: it settles only when the page goes.
    const pending = evaluate(h, 'new Promise(() => {})');
    const early = await Promise.race([pending, sleep(500).then(() => 'pending')]);
    await evaluate(h, "(setTimeout(() => (location.href = '/spa.html?from=hostile'), 100), 1)");
    const settled = await Promise.race([pending, sleep(5000).then(() => 'still pending')]);
    r.since(
      WEBVIEW.evaluate,
      'F3 an evaluate the page holds pending rejects navigated once the page navigates itself',
      all(early === 'pending', settled === 'navigated'),
      { early, settled }
    );
  } finally {
    unhandle();
    unlisten();
    h.setProps({});
  }
}

/**
 * T4: the page's call ids restart with each document (`p1`), so an answer to the previous document's call could
 * settle the next document's: the document token drops it.
 */
async function staleAnswer({ h, r }: Suite) {
  const calls: Record<string, number> = {};
  const answers: Record<string, number> = {};
  const unhandle = h.bridge.handle('hostileSlow', async (params) => {
    const { from, ms } = params as { from: string; ms: number };
    calls[from] = Date.now();
    await sleep(ms);
    answers[from] = Date.now();
    return from;
  });
  try {
    await openPage(h, fresh(h, '/hostile.html?stale=A'));
    const next = fresh(h, '/hostile.html?stale=B');
    const inFlight = h.bridge.call('slowPage').catch(errorCode);
    await evaluate(
      h,
      `(nativeBridge.call('hostileSlow', { from: 'A', ms: 1500 }), setTimeout(() => (location.href = ${JSON.stringify(next)}), 100), 1)`
    );
    const rn = await Promise.race([inFlight, sleep(5000).then(() => 'still pending')]);
    await waitFor(h, (s) => s.url === next && idle(s));
    const stale = (await until(() => evaluate(h, 'window.__stale'), 6000)) as
      { result?: string } | undefined;
    // Only a race: B's call was waiting when A's answer came. (B's 2500 ms ends after A's 1500 ms, within the
    // page's 3 s bridge timeout.)
    const raced = (calls.B ?? Infinity) < (answers.A ?? 0);
    r.since(
      WEBVIEW.bridge,
      "T4 an answer to the previous document's call does not settle the next document's call with the same id",
      all(raced, stale?.result === 'B'),
      { stale, calls, answers }
    );
    r.since(
      WEBVIEW.bridge,
      'T4 an app call in flight rejects navigated when the page navigates itself',
      rn === 'navigated',
      rn
    );
    r.info('T4 what native delivered to B', await evaluate(h, 'window.__delivered'));
    r.info("T4 from A's call (ms): A answered, B called, B answered", [
      (answers.A ?? NaN) - (calls.A ?? NaN),
      (calls.B ?? NaN) - (calls.A ?? NaN),
      (answers.B ?? NaN) - (calls.A ?? NaN),
    ]);
  } finally {
    unhandle();
  }
}

/**
 * T5: a new window to an internal scheme or file: never loads, even when a rule allows every new window. Android taps.
 */
async function newWindows(suite: Suite) {
  const { h, r, android } = suite;
  const external: string[] = [];
  h.setProps({ onOpenExternal: (url) => void external.push(url) });
  h.setRules([
    { newWindow: true, action: 'allow' },
    { scheme: ['http', 'https'], action: 'allow' },
  ]);
  await sleep(300);
  const page = fresh(h, '/hostile.html');
  await openPage(h, page);
  const sentinelsNow = async () =>
    JSON.stringify(
      await evaluate(
        h,
        '[window.__hostileData, window.__hostileJs, window.__hostileBlob, window.__hostileBlank]'
      )
    );
  for (const [id, label] of [
    ['open-data', 'window.open to data:'],
    ['open-js', 'window.open to javascript:'],
    ['open-blob', 'window.open to blob:'],
    ['open-file', 'window.open to file:'],
    ['blank-data', 'target=_blank to data:'],
  ] as const) {
    const [loads, navigations] = [h.events.loads.length, h.events.navigations.length];
    // A sentinel an earlier window set fails that window's check only.
    const before = await sentinelsNow();
    const clicked = await gesture(suite, id);
    await until(() => h.events.navigations.length > navigations, 2000);
    await sleep(1000); // a load the core wrongly let in would have started by now
    const decisions = h.events.navigations.slice(navigations);
    const sentinels = await sentinelsNow();
    const scriptMayRun = android && id === 'open-js';
    r.check(
      `T5 a tapped ${label} does not load, with a rule that allows every new window`,
      all(
        clicked,
        h.state().url === page,
        !decisions.some((decision) => decision.action === 'allow'),
        !h.events.loads.slice(loads).includes('start'),
        scriptMayRun || sentinels === before,
        external.length === 0
      ),
      { clicked, url: h.state().url, decisions, before, sentinels, external }
    );
    if (scriptMayRun && sentinels !== before)
      r.info(`known limit (WebView): T5 a tapped ${label} ran its script`, sentinels);
    r.info(`T5 ${label}: decisions`, decisions);
  }
}

/** F1: with no rules, a page sends the main frame to a custom scheme with no gesture: it goes external. */
async function defaultScheme({ h, r }: Suite) {
  const external: string[] = [];
  h.setProps({ onOpenExternal: (url) => void external.push(url) });
  h.setRules(undefined);
  await sleep(300);
  const page = fresh(h, '/hostile.html');
  await openPage(h, page);
  const url = 'mrwhostile://open?from=script';
  const navigations = h.events.navigations.length;
  await evaluate(h, `(location.href = ${JSON.stringify(url)}, 1)`);
  await until(() => external.length > 0, 3000);
  await sleep(300);
  const decision = h.events.navigations.slice(navigations).find((n) => n.url === url);
  r.check(
    'F1 with no rules, a scripted custom-scheme navigation is reported as not user-initiated, the page stays',
    all(decision?.mainFrame === true, decision?.userInitiated === false, h.state().url === page),
    { decision, external }
  );
  r.info(
    'F1 no gesture gate: with no rules the scripted URL went to onOpenExternal (or else the OS)',
    {
      action: decision?.action,
      external,
    }
  );
}

/** Runs `act` and waits for the next error: it, and the URL the page then shows. */
async function nextError(h: Harness, act: () => void) {
  const errors = h.events.errors.length;
  act();
  await until(() => h.events.errors.length > errors, 10000);
  await waitFor(h, idle, 5000);
  await sleep(300);
  return { error: h.events.errors[errors], shown: await evaluate(h, 'location.href') };
}

/** T9: an SSL error is cancelled and reported, on a load and on a back/forward load. */
async function ssl({ h, r, android }: Suite) {
  const before = fresh(h, '/hostile.html?ssl=before');
  await openPage(h, before);
  const bad = fresh(h, `${HTTPS}/spa.html?ssl=1`);
  const load = await nextError(h, () => h.load(bad));
  r.check(
    'T9 an SSL error on a load is cancelled and reported',
    all(load.error?.kind === 'ssl', load.error?.url === bad, load.shown !== bad),
    load
  );

  await openPage(h, fresh(h, '/hostile.html?ssl=after'));
  const errors = h.events.errors.length;
  h.ref.current?.goBack();
  const back = await waitFor(h, (s) => s.url === before && idle(s), 5000);
  await sleep(500);
  r.check(
    'T9 a failed SSL load leaves no back/forward entry: back returns to the page before it',
    all(back, h.events.errors.length === errors),
    { state: h.state(), errors: h.events.errors.slice(errors) }
  );
  // An entry that loaded and now redirects to the bad certificate: a pushState entry, of a page the back/forward cache
  // doesn't keep (off here), so going back requests its URL. iOS restores the page from WebKit's cache instead (no
  // request, no error), and WKWebView has no public switch for that cache.
  if (!android) return;
  h.setProps({ android: { settings: { backForwardCacheEnabled: false } } });
  await sleep(300);
  const badAgain = fresh(h, `${HTTPS}/spa.html?ssl=2`);
  const entry = `${h.pages}/redirect?to=${encodeURIComponent(badAgain)}`;
  await openPage(h, fresh(h, '/hostile.html?ssl=entry'));
  await evaluate(h, `(history.pushState(null, '', ${JSON.stringify(entry)}), 1)`);
  await waitFor(h, (s) => s.url === entry, 3000);
  await openPage(h, fresh(h, '/hostile.html?ssl=next'));
  const travel = await nextError(h, () => h.ref.current?.goBack());
  r.since(
    WEBVIEW.navigationListener,
    'T9 a back/forward load redirected to a bad certificate is cancelled and reported',
    all(travel.error?.kind === 'ssl', travel.error?.url === badAgain, travel.shown !== badAgain),
    { ...travel, state: h.state() }
  );
  h.setProps({});
}

/** Clicks a download link and waits for the download's event: undefined when none came. */
async function download(h: Harness, id: string) {
  const [ok, failed] = [h.events.downloads.length, h.events.downloadFailures.length];
  await evaluate(h, `(document.getElementById('${id}').click(), 1)`);
  await until(
    () => h.events.downloads.length > ok || h.events.downloadFailures.length > failed,
    20000
  );
  return (h.events.downloads[ok] ?? h.events.downloadFailures[failed]) as
    Download | DownloadFailure | undefined;
}

/** In a directory of its own (Android's cache/downloads/<n>/, iOS's tmp/<UUID>/), and not named `.` or `..`. */
const inOwnDirectory = (uri: string) =>
  /\/(downloads\/\d+|tmp\/[0-9A-F-]{36})\/[^/]+$/i.test(uri) &&
  !['.', '..'].includes(decodeURIComponent(uri.split('/').at(-1) ?? ''));

/** A saved download: its file name, its text, and where `<dir>/../../evil.txt` would have landed. */
async function savedAs(saved: Download) {
  const name = decodeURIComponent(saved.uri.split('/').at(-1) ?? '');
  const escaped = new File(`${saved.uri.split('/').slice(0, -3).join('/')}/evil.txt`);
  return { name, escaped, body: await new File(saved.uri).text() };
}

/** T7: ../../evil.txt in a download's page-chosen name never leaves its own directory. The saved download, if any. */
async function traversalName({ h, r }: Suite) {
  await openPage(h, fresh(h, '/hostile.html'));
  const traversal = await download(h, 'dl-traversal');
  const saved = traversal?.ok ? await savedAs(traversal) : undefined;
  r.check(
    'T7 a download named ../../evil.txt is saved under a plain name in its own directory',
    all(
      !!traversal?.ok && inOwnDirectory(traversal.uri),
      saved?.name === traversal?.filename,
      saved?.body.startsWith('downloaded ../../evil.txt') === true,
      saved?.escaped.exists === false
    ),
    { traversal, name: saved?.name, escaped: saved?.escaped.uri, body: saved?.body.slice(0, 40) }
  );
  r.info('T7 ../../evil.txt saved as', traversal);
  return traversal?.ok ? traversal : undefined;
}

/** T7: a download named `..` stays in its own directory or fails, and the earlier download is kept. */
async function dotdotName({ h, r }: Suite, saved: Download | undefined) {
  const dotdot = await download(h, 'dl-dotdot');
  const kept = saved ? new File(saved.uri).exists : false;
  r.check(
    'T7 a download named .. stays in its own directory or fails, and earlier downloads are kept',
    all(!!dotdot, !dotdot?.ok || inOwnDirectory(dotdot.uri), kept),
    { dotdot, kept }
  );
  r.info('T7 .. saved as', dotdot);
}

const downloadNames = async (s: Suite) => await dotdotName(s, await traversalName(s));

/** T7: Android fetches a download again and follows its redirect: each hop gets only its own host's cookies. */
async function downloadRedirect({ h, r, android }: Suite) {
  await openPage(h, fresh(h, '/hostile.html'));
  const cookie = `hostile${Date.now()}`;
  await evaluate(h, `(document.cookie = '${cookie}=1; path=/', 1)`);
  const moved = await download(h, 'dl-moved');
  const body = moved?.ok ? await new File(moved.uri).text() : null;
  await evaluate(h, `(document.cookie = '${cookie}=; path=/; max-age=0', 1)`);
  if (android)
    r.check(
      "T7 a download redirected to another host carries none of the first host's cookies",
      all(body?.startsWith('downloaded moved.txt') === true, !body?.includes(cookie)),
      { moved, body }
    );
  else r.info("T7 iOS saves WebKit's first response, with no second fetch", { moved, body });
}

/** F3: Android reads a blob: download through the page's own fetch, so the page can keep it from finishing. */
async function heldBlob({ h, r, android }: Suite) {
  if (!android) {
    r.info('F3 held blob: skipped', 'iOS reads a blob: download in WebKit, not through the page');
    return;
  }
  await openPage(h, fresh(h, '/hostile.html'));
  const events = () => h.events.downloads.length + h.events.downloadFailures.length;
  const [before, failures] = [events(), h.events.downloadFailures.length];
  await evaluate(
    h,
    "(window.fetch = () => new Promise(() => {}), document.getElementById('dl-held').click(), 1)"
  );
  await sleep(3000);
  const held = events() === before;
  await evaluate(h, "(location.href = '/spa.html?from=held', 1)");
  await until(() => h.events.downloadFailures.length > failures, 5000);
  const failure = h.events.downloadFailures[failures];
  r.since(
    WEBVIEW.evaluate,
    'F3 a blob download the page never lets finish waits for the page, and fails when it navigates',
    all(held, failure?.reason.includes('navigated') === true),
    { held, failure }
  );
  r.info('F3 the held blob download', { held, failure });
}

/** T8: a web page can't send the main frame to file:, and a file: source reads only its own directory. */
async function fileScope({ h, r, android }: Suite) {
  const stamp = Date.now();
  const dir = new Directory(Paths.cache, `hostile-${stamp}`);
  const site = new Directory(dir, 'site');
  // Far outside the source's directory: the app's Documents, then /etc/hosts.
  const far = new File(Paths.document, `hostile-far-${stamp}.js`);
  site.create({ intermediates: true });
  try {
    await new File(site, 'inside.js').write('window.__inside = 1');
    await new File(dir, 'outside.js').write('window.__outside = 1');
    await far.write('window.__far = 1');
    const html = `<!doctype html><script src="inside.js"></script><script src="../outside.js"></script>
      <script src="${far.uri}"></script><script src="file:///etc/hosts" onload="window.__etc = 1"></script>
      <p id="local">local</p>`;
    const [first, second] = ['index.html', 'again.html'].map((name) => new File(site, name));
    for (const file of [first!, second!]) await file.write(html);

    const page = fresh(h, '/hostile.html');
    await openPage(h, page);
    const navigations = h.events.navigations.length;
    await evaluate(h, `(location.href = ${JSON.stringify(first!.uri)}, 1)`);
    await sleep(1500);
    const decisions = h.events.navigations.slice(navigations);
    r.check(
      'T8 a web page cannot navigate the main frame to file:',
      all(
        h.state().url === page,
        (await evaluate(h, 'location.href')) === page,
        !decisions.some((decision) => decision.action === 'allow')
      ),
      { state: h.state(), decisions }
    );
    r.info("T8 decisions for the page's file: navigation", decisions);

    /** Loads `file` as the source: [its text, then whether its dir, the dir above, Documents, /etc/hosts loaded]. */
    const read = async (file: File) => {
      const loads = h.events.loads.length;
      h.loadSource({ uri: file.uri });
      await waitFor(h, (s) => h.events.loads.slice(loads).includes('end') && idle(s));
      await sleep(300);
      return (await evaluate(
        h,
        `[document.getElementById('local')?.textContent ?? null, ...['__inside', '__outside', '__far', '__etc'].map((k) => window[k] === 1)]`
      )) as unknown[] | string | undefined;
    };
    if (!android) {
      const scope = await read(first!);
      // Without the WebContent sandbox (the simulator) WebKit reads any file: only a device can check the read root.
      if (Array.isArray(scope) && scope[3] === true)
        r.info(
          'T8 iOS: the file: source read outside its directory, Documents too: no WebContent sandbox',
          scope
        );
      else
        r.check(
          'T8 a file: source reads its own directory, not the one above it',
          JSON.stringify(scope) === '["local",true,false,false,false]',
          scope
        );
      return;
    }
    const errors = h.events.errors.length;
    const blocked = await read(first!);
    r.check(
      'T8 Android: a file: source does not load without allowFileAccess',
      all(
        !(Array.isArray(blocked) && blocked[0] === 'local'),
        h.events.errors.slice(errors).some((error) => error.kind === 'network')
      ),
      { blocked, errors: h.events.errors.slice(errors) }
    );
    h.setProps({ android: { settings: { allowFileAccess: true } } });
    await sleep(300);
    r.info(
      'T8 Android: with allowFileAccess, a file: source reads [page, its dir, the dir above, Documents, /etc/hosts]',
      await read(second!)
    );
  } finally {
    dir.delete();
    if (far.exists) far.delete();
  }
}

/** In run order; the Android taps all come from newWindows (five). */
const BLOCKS = [
  bridgeGate,
  staleAnswer,
  newWindows,
  defaultScheme,
  ssl,
  downloadNames,
  downloadRedirect,
  heldBlob,
  fileScope,
];

export async function hostile(h: Harness) {
  const r = reporter('hostile');
  const suite: Suite = { h, r, android: Platform.OS === 'android' };
  for (const block of BLOCKS) await block(suite);
  r.done();
}
