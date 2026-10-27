// The `shapes` suite: the flows apps are built from (a hybrid site, OAuth, 3-D Secure, new windows, schemes, documents,
// uploads, an SPA), each pinned to its expectation per platform. The checks drive a ShapeHost, so another WebView
// library can run the same checks under the same names.
import type {
  FileRequest,
  NavigationEvent,
  NavigationRule,
  NavigationState,
  PermissionRequest,
} from 'minimal-rn-webview';
import { BackHandler, Platform } from 'react-native';

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

/** The blocks' policies: the rule sets in RULES. */
type Policy = 'hybrid' | 'oauth' | 'checkout' | 'windows' | 'schemes' | 'none';

/** What the shape checks drive and read: this library's WebView in `libraryHost`. */
export type ShapeHost = {
  /**
   * Applies a block's policy. `external: false` leaves external URLs to the library (no capturing `onOpenExternal`),
   * `downloads: false` drops `onDownload`, `inCheckout` makes the checkout `ask` allow instead of going external.
   */
  use: (
    policy: Policy,
    options?: { external?: boolean; downloads?: boolean; inCheckout?: boolean }
  ) => Promise<void>;
  /** Loads a test page (a path on the test server, or a full URL) with a cache-buster: its URL, once it has loaded. */
  open: (path: string) => Promise<string>;
  /** A click from script; with `frame`, on an element in that same-origin iframe. */
  click: (id: string, frame?: string) => Promise<unknown>;
  /** A user gesture: the driver's real tap on Android, a click from script on iOS (WebKit counts it as one). */
  tap: (id: string, frame?: string) => Promise<unknown>;
  evaluate: (script: string) => Promise<unknown>;
  state: () => NavigationState;
  goBack: () => void;
  reload: () => void;
  /** Since the last `clear`: what reached onOpenExternal, what an `ask` rule asked, and every decision. */
  external: string[];
  asked: string[];
  decisions: NavigationEvent[];
  clear: () => void;
};

type Shape = { h: Harness; r: ReturnType<typeof reporter>; s: ShapeHost; android: boolean };

const PAGES = 'http://localhost:8090';
/** Another site: the IdP, the bank, an app-link host. */
const OTHER = 'http://127.0.0.1:8090';

const RULES: Record<Policy, NavigationRule[] | undefined> = {
  hybrid: [
    { host: ['localhost'], action: 'allow' },
    { scheme: ['http', 'https'], mainFrame: false, action: 'allow' },
    { mainFrame: true, action: 'external' },
  ],
  oauth: [
    { scheme: ['mrwshapes'], action: 'ask' },
    { host: ['localhost'], path: ['/shapes-callback'], action: 'ask' },
    { host: ['localhost', '127.0.0.1'], action: 'allow' },
    { scheme: ['http', 'https'], mainFrame: false, action: 'allow' },
    { mainFrame: true, action: 'external' },
  ],
  checkout: [
    { host: ['localhost'], action: 'allow' },
    { scheme: ['http', 'https'], mainFrame: false, action: 'allow' },
    { scheme: ['http', 'https'], mainFrame: true, newWindow: false, action: 'ask' },
    { mainFrame: true, action: 'external' },
  ],
  windows: [
    { host: ['localhost'], action: 'allow' },
    { newWindow: true, action: 'external' },
    { scheme: ['http', 'https'], mainFrame: false, action: 'allow' },
    { mainFrame: true, action: 'external' },
  ],
  schemes: [
    {
      scheme: ['tel', 'mailto', 'sms', 'maps', 'market', 'itms-apps', 'intent'],
      mainFrame: true,
      action: 'external',
    },
    { host: ['127.0.0.1'], path: ['/applink'], mainFrame: true, action: 'external' },
    { host: ['localhost'], action: 'allow' },
    { scheme: ['http', 'https'], mainFrame: false, action: 'allow' },
    { mainFrame: true, action: 'block' },
  ],
  none: undefined,
};

function libraryHost(h: Harness, r: ReturnType<typeof reporter>): ShapeHost {
  const byId = (id: string, frame?: string) =>
    `${frame ? `document.getElementById(${JSON.stringify(frame)}).contentDocument` : 'document'}.getElementById(${JSON.stringify(id)})`;
  const host: ShapeHost = {
    use: async (policy, { external = true, downloads = true, inCheckout = false } = {}) => {
      h.setRules(RULES[policy]);
      // The OAuth ask takes the return URL and blocks it; the checkout ask lets an unknown bank in only in checkout.
      h.setAsk((request) => {
        host.asked.push(request.url);
        if (policy !== 'checkout') return 'block';
        return inCheckout ? 'allow' : 'external';
      });
      h.setProps({
        ...(external ? { onOpenExternal: (url: string) => void host.external.push(url) } : {}),
        ...(downloads ? {} : { onDownload: undefined }),
      });
      await sleep(300);
    },
    open: async (path) => {
      const url = fresh(h, path);
      await openPage(h, url);
      return url;
    },
    // A click on a page that went away shows in the check that follows, so the suite goes on.
    click: (id, frame) => host.evaluate(`${byId(id, frame)}.click()`).catch(String),
    tap: async (id, frame) => {
      if (Platform.OS !== 'android') return await host.click(id, frame);
      r.info('TAP', await tapPoint(h, id, frame));
    },
    evaluate: async (script) => await h.ref.current?.evaluate(script),
    state: h.state,
    goBack: () => h.ref.current?.goBack(),
    reload: () => h.ref.current?.reload(),
    external: [],
    asked: [],
    decisions: h.events.navigations,
    clear: () => {
      host.external.length = 0;
      host.asked.length = 0;
      host.decisions.length = 0;
    },
  };
  return host;
}

export const all = (...conditions: boolean[]) => conditions.every(Boolean);
/** Whether `value` has each of `fields`, compared with ===. */
const has = (value: object | undefined, fields: Record<string, unknown>) =>
  value !== undefined &&
  Object.entries(fields).every(([key, field]) => (value as Record<string, unknown>)[key] === field);

const stays = (s: ShapeHost, url: string) => s.state().url === url;
/** The last decision about a URL that contains `part`. */
const decision = (s: ShapeHost, part: string) =>
  s.decisions.filter((n) => n.url.includes(part)).at(-1);
const href = async (s: ShapeHost, id: string) =>
  String(await s.evaluate(`document.getElementById(${JSON.stringify(id)}).href`));
const body = (s: ShapeHost) =>
  s.evaluate(`document.getElementById('body')?.textContent ?? ''`).catch(String);
/** Runs `act`, then waits for the lines the page adds to `window.testLog` (the hub logs every click); null if none. */
async function lines(s: ShapeHost, act: () => unknown, ms = 15000) {
  const before = Number(await s.evaluate('window.testLog.length'));
  await act();
  const added = async () => {
    const value = await s.evaluate(`(window.testLog ?? []).slice(${before})`).catch(String);
    return Array.isArray(value) && value.length > 0 ? (value as string[]) : undefined;
  };
  return (await until(added, ms)) ?? null;
}
/** The hub, freshly loaded, with the logs cleared: most checks start there. */
async function hub(s: ShapeHost) {
  const url = await s.open('/shapes.html');
  s.clear();
  return url;
}
/** Clears the logs, runs `act`, and waits for an `ask` and what follows it. */
async function askAfter(s: ShapeHost, act: () => unknown) {
  s.clear();
  await act();
  await until(() => s.asked.length > 0, 5000);
  await sleep(500);
}
const agrees = async (s: ShapeHost) =>
  (await until(
    async () => (await s.evaluate('location.href').catch(String)) === s.state().url,
    2000
  )) === true;
async function push(s: ShapeHost) {
  await s.click('push');
  await waitFor(s, (st) => st.url.includes('/spa/pushed'), 3000);
  return s.state().url;
}
/**
 * Opens a page and then the SPA, adds a pushState and a hash entry with `act`, and goes back twice: where each lands.
 */
async function walkBack(s: ShapeHost, act: (id: string) => Promise<unknown>) {
  const before = await s.open('/spa.html?from=before');
  const start = await s.open('/spa.html');
  await act('push');
  await waitFor(s, (st) => st.url.includes('/spa/pushed'), 10000);
  const pushed = s.state().url;
  await act('hash');
  await waitFor(s, (st) => st.url.includes('#h'), 10000);
  const back = async () => {
    const from = s.state().url;
    s.goBack();
    await waitFor(s, (st) => st.url !== from && idle(st), 3000);
    return { url: s.state().url, agrees: await agrees(s) };
  };
  const first = await back();
  return { before, start, pushed, first, second: await back() };
}

/** 1. A hybrid app on its own domain: its links load in place, other sites open externally. */
async function hybrid({ r, s }: Shape) {
  await s.use('hybrid');
  await hub(s);
  await s.click('own');
  const own = await waitFor(s, (st) => st.url === `${PAGES}/spa.html?from=own` && idle(st));
  r.check(
    'A1 hybrid: an own-site link loads in place',
    all(own, has(decision(s, 'from=own'), { action: 'allow', rule: 0 })),
    { url: s.state().url, decision: decision(s, 'from=own') }
  );

  let page = await hub(s);
  await s.click('other');
  await until(() => s.external.length > 0, 3000);
  await sleep(300);
  r.check(
    "A2 hybrid: another site's link goes external, the page stays",
    all(
      s.external.join() === `${OTHER}/spa.html?from=other`,
      has(decision(s, 'from=other'), { action: 'external', rule: 2 }),
      stays(s, page)
    ),
    { external: s.external, decision: decision(s, 'from=other'), url: s.state().url }
  );

  page = await hub(s);
  await s.click('offsite');
  await until(() => s.external.length > 0 && s.state().outcome === 'cancelled', 5000);
  r.since(
    WEBVIEW.navigationListener,
    'A3 hybrid: a server redirect off-site goes external',
    all(
      s.external.join() === `${OTHER}/spa.html?from=redirect`,
      stays(s, page),
      s.state().outcome === 'cancelled'
    ),
    { external: s.external, state: s.state() }
  );
}

/** 1. (cont.) Iframes: another site's link loads in the frame, a tel: link there is blocked. Taps on Android. */
async function frames({ r, s, android }: Shape) {
  let page = await hub(s);
  const frameLoads = async () => Number(await s.evaluate('window.frameLoads'));
  const loadsBefore = await frameLoads();
  await s.tap('frame-other', 'frame');
  const moved = (await until(async () => (await frameLoads()) > loadsBefore, 15000)) === true;
  await sleep(500);
  const other = decision(s, 'from=frame');
  // Android never shows the rules an iframe's http(s) navigation, tapped or not (NavigationRule.mainFrame).
  if (android) r.info('A4 Android decision for the tapped http(s) iframe link', other ?? 'none');
  r.check(
    'A4 hybrid: an iframe link to another site loads in the iframe',
    all(
      moved,
      s.external.length === 0,
      stays(s, page),
      android || has(other, { mainFrame: false, action: 'allow', rule: 1 })
    ),
    { moved, external: s.external, decision: other }
  );

  page = await hub(s);
  const tapped = await lines(s, () => s.tap('frame-tel', 'frame'));
  await sleep(1000);
  const tel = decision(s, 'tel:+3725550000');
  if (android) r.info('A5 Android decision for the tapped iframe tel:', tel ?? 'none');
  r.check(
    'A5 hybrid: a tel: link inside the iframe is blocked',
    all(
      tapped !== null,
      s.external.length === 0,
      stays(s, page),
      android
        ? !has(tel, { action: 'allow' })
        : has(tel, { mainFrame: false, action: 'block', rule: null })
    ),
    { tapped, external: s.external, decision: tel }
  );
}

/** 2. OAuth through a third-party IdP: the return, on a custom scheme or the app's callback path, is asked. */
async function oauth({ r, s }: Shape) {
  await s.use('oauth');
  await hub(s);
  const idp = await href(s, 'login');
  await s.click('login');
  r.check(
    'B1 oauth: the IdP page on another origin loads',
    await waitFor(s, (st) => st.url === idp && idle(st)),
    s.state()
  );
  await askAfter(s, () => s.click('signin'));
  r.check(
    'B2 oauth: a 302 to the custom scheme is asked with the code, the IdP page stays',
    all(
      s.asked.join() === 'mrwshapes://cb?code=302',
      has(decision(s, 'mrwshapes:'), { action: 'block', rule: 0 }),
      stays(s, idp)
    ),
    { asked: s.asked, decision: decision(s, 'mrwshapes:'), url: s.state().url }
  );
  await askAfter(s, () => s.evaluate(`location.href = 'mrwshapes://cb?code=js'`));
  r.check(
    'B3 oauth: a script redirect to the custom scheme is asked',
    s.asked.join() === 'mrwshapes://cb?code=js',
    s.asked
  );
  const callback = `${PAGES}/shapes-callback`;
  const callbackIdp = await s.open(
    `${OTHER}/shapes-idp.html?return=${encodeURIComponent(callback)}`
  );
  await askAfter(s, () => s.click('signin'));
  r.check(
    'B4 oauth: a 302 to the callback path is asked and blocked',
    all(s.asked.join() === `${callback}?code=302`, stays(s, callbackIdp)),
    { asked: s.asked, url: s.state().url }
  );
  await askAfter(s, () => s.open(`${OTHER}/shapes-idp.html?auto=1`));
  r.check(
    'B5 oauth: an SSO auto-return on load is asked',
    s.asked.join() === 'mrwshapes://cb?code=auto',
    s.asked
  );
  await hub(s);
  await s.tap('login-popup');
  const popup = `${OTHER}/shapes-idp.html?popup=1`;
  const popped = await waitFor(s, (st) => st.url === popup && idle(st), 15000);
  const noOpener = await s.evaluate('window.opener === null').catch(String);
  r.check(
    'B6 oauth: a popup login loads in place with no window.opener',
    all(
      popped,
      noOpener === true,
      has(decision(s, 'popup=1'), { newWindow: true, action: 'allow', rule: 2 })
    ),
    { url: s.state().url, noOpener, decision: decision(s, 'popup=1') }
  );
}

/** 3. Checkout: 3-D Secure in the bank's iframe, or a full-page POST to a bank the app can't list (no rule sees it). */
async function checkout({ r, s, android }: Shape) {
  await s.use('checkout');
  s.clear();
  await s.open('/shapes-pay.html?mode=frame');
  const paid = await waitFor(s, (st) => st.url === `${PAGES}/spa.html?from=paid` && idle(st));
  r.check(
    'C1 checkout: the 3-D Secure iframe completes and the page moves on',
    all(paid, s.asked.length === 0),
    { url: s.state().url, asked: s.asked }
  );
  const acsFrame = s.decisions.find((n) => n.url.startsWith(`${OTHER}/shapes-acs.html`));
  if (android)
    r.info(
      'C2 Android: iframe decisions in the 3-D Secure flow',
      s.decisions.filter((n) => !n.mainFrame)
    );
  else
    r.check(
      'C2 checkout: the ACS iframe is decided as a subframe',
      has(acsFrame, { mainFrame: false, action: 'allow', rule: 1 }),
      acsFrame
    );

  // The rules never see a form POST, on either platform: whatever the `ask` would answer, nothing is asked or decided.
  const term = `${PAGES}/post?term=1`;
  const unruled = () => s.asked.length === 0 && s.decisions.length === 0;
  await s.use('checkout', { inCheckout: true });
  s.clear();
  await s.open('/shapes-pay.html?mode=top');
  const posted = await waitFor(s, (st) => st.url === term && idle(st));
  const paRes = await body(s);
  r.check(
    'C3 checkout: a full-page POST to an unlisted bank loads while in checkout',
    all(posted, paRes === 'PaRes=ok', unruled()),
    { url: s.state().url, body: paRes, asked: s.asked, decisions: s.decisions }
  );

  // Outside checkout the `ask` would send the bank external: the POST loads in place all the same.
  await s.use('checkout', { inCheckout: false });
  s.clear();
  await s.open('/shapes-pay.html?mode=top');
  await waitFor(s, (st) => st.url === term && idle(st));
  await sleep(500);
  r.check(
    'C4 checkout: the same POST outside checkout',
    all(stays(s, term), s.external.length === 0, unruled()),
    { external: s.external, asked: s.asked, decisions: s.decisions, url: s.state().url }
  );
}

/** 4. target=_blank and window.open, tapped: same-site windows load in place, other sites' open externally. */
async function windows({ r, s }: Shape) {
  await s.use('windows');
  let page = await hub(s);
  await s.tap('blank-own');
  const blank = await waitFor(
    s,
    (st) => st.url === `${PAGES}/spa.html?from=blank` && idle(st),
    15000
  );
  const blankOwn = decision(s, 'from=blank');
  s.goBack();
  const returned = await waitFor(s, (st) => st.url === page && idle(st), 5000);
  r.check(
    'D1 windows: a same-site target=_blank loads in place, goBack returns to the opener page',
    all(blank, has(blankOwn, { newWindow: true, action: 'allow', rule: 0 }), returned),
    { blank, decision: blankOwn, url: s.state().url }
  );

  page = await hub(s);
  await s.tap('blank-other');
  await until(() => s.external.length > 0, 15000);
  await sleep(300);
  r.check(
    "D2 windows: another site's target=_blank goes external",
    all(
      s.external.join() === `${OTHER}/spa.html?from=blank-other`,
      has(decision(s, 'blank-other'), { newWindow: true, action: 'external', rule: 1 }),
      stays(s, page)
    ),
    { external: s.external, decision: decision(s, 'blank-other'), url: s.state().url }
  );

  await hub(s);
  await s.tap('open-own');
  const opened = await waitFor(
    s,
    (st) => st.url === `${PAGES}/spa.html?from=open` && idle(st),
    15000
  );
  const noOpener = await s.evaluate('window.opener === null').catch(String);
  r.check(
    'D3 windows: a same-site window.open has no window.opener',
    all(opened, noOpener === true),
    { url: s.state().url, noOpener }
  );
}

/** 4. (cont.) window.open('') with a later location, and a form POST into a new window, where the platforms split. */
async function deferredWindows({ r, s, android }: Shape) {
  await hub(s);
  const log = await lines(s, () => s.tap('open-deferred'));
  // A throwaway window catches the URL the opener sets (within 5 s), which the rules decide as a new window.
  const deferred = `${PAGES}/spa.html?from=deferred`;
  await waitFor(s, (st) => st.url === deferred && idle(st), 8000);
  r.check(
    "D4 windows: window.open('') and a later location",
    all(
      String(log).includes('opened window'),
      stays(s, deferred),
      has(decision(s, 'from=deferred'), { newWindow: true, action: 'allow' })
    ),
    { log, url: s.state().url, decision: decision(s, 'from=deferred') }
  );

  const page = await hub(s);
  if (android) {
    const submitted = await lines(s, () => s.tap('post-blank-submit'));
    await sleep(3000);
    r.check(
      'D5 windows: a form POST to a new window',
      all(submitted !== null, stays(s, page), !s.decisions.some((n) => n.url.includes('/post'))),
      { submitted, url: s.state().url, decisions: s.decisions }
    );
    return;
  }
  await s.tap('post-blank-submit');
  const posted = await waitFor(s, (st) => st.url === `${PAGES}/post?from=blank` && idle(st));
  r.check(
    'D5 windows: a form POST to a new window',
    all(posted, !s.decisions.some((n) => n.url.includes('/post'))),
    { state: s.state(), decisions: s.decisions }
  );
  r.info('D5 iOS: the POST body after it loaded in place', await body(s));
}

/** 5. Schemes and app links: each reaches onOpenExternal as the page wrote it. */
async function schemes({ r, s }: Shape) {
  await s.use('schemes');
  const page = await hub(s);
  for (const [i, id] of ['tel', 'mailto', 'sms', 'maps', 'market', 'itms', 'intent'].entries()) {
    s.clear();
    const link = await href(s, id);
    await s.click(id);
    await until(() => s.external.length > 0, 3000);
    await sleep(id === 'intent' ? 1000 : 200); // an intent:'s fallback would have loaded by now
    r.check(
      `E${i + 1} schemes: ${link.split(':')[0]}: reaches onOpenExternal as written, the page stays`,
      all(
        s.external.join() === link,
        has(s.decisions.at(-1), { action: 'external', rule: 0 }),
        stays(s, page)
      ),
      { link, external: s.external, decision: s.decisions.at(-1), url: s.state().url }
    );
  }
  s.clear();
  await s.click('applink');
  await until(() => decision(s, '/applink/') !== undefined, 3000);
  r.check(
    'E8 schemes: an app-link host rule sends https external',
    all(
      s.external.join() === `${OTHER}/applink/x`,
      has(s.decisions.at(-1), { action: 'external', rule: 1 }),
      stays(s, page)
    ),
    { external: s.external, decision: s.decisions.at(-1) }
  );
}

/** 5. (cont.) An intent: without onOpenExternal, and tel: with no rules at all. */
async function schemeDefaults({ r, s, android }: Shape) {
  await s.use('schemes', { external: false });
  const page = await hub(s);
  await s.click('intent');
  await until(() => decision(s, 'intent:') !== undefined, 5000);
  await sleep(1000);
  const intent = { decision: decision(s, 'intent:'), url: s.state().url };
  // Android opens its fallback (the navigation suite checks that); iOS has nothing that opens an intent:.
  if (android) r.info('E9 Android: an intent: without onOpenExternal', intent);
  else
    r.check(
      'E9 schemes: without onOpenExternal an intent: is reported block',
      all(has(intent.decision, { action: 'block' }), stays(s, page)),
      intent
    );

  await s.use('none');
  await hub(s);
  await s.click('tel');
  await until(() => decision(s, 'tel:') !== undefined, 3000);
  const main = { external: s.external.join(), decision: s.decisions.at(-1) };
  s.clear();
  const tapped = await lines(s, () => s.tap('frame-tel', 'frame'));
  await sleep(1000);
  const framed = decision(s, 'tel:+3725550000');
  r.check(
    'E10 schemes: with no rules, tel: goes external from the main frame and is blocked from an iframe',
    all(
      main.external === 'tel:+3725551234',
      has(main.decision, { action: 'external', rule: null }),
      tapped !== null,
      s.external.length === 0,
      android
        ? !has(framed, { action: 'allow' })
        : has(framed, { mainFrame: false, action: 'block' })
    ),
    { main, tapped, external: s.external, frame: framed }
  );
}

/** 6. Document viewer: a PDF link, with and without onDownload. */
async function documents({ h, r, s, android }: Shape) {
  const pdf = `${PAGES}/shapes.pdf`;
  for (const downloads of [true, false]) {
    await s.use('none', { downloads });
    const page = await hub(s);
    const before = h.events.downloads.length;
    await s.click('pdf');
    const name = downloads
      ? 'F1 docs: a PDF link shows inline on iOS, arrives in onDownload on Android'
      : 'F2 docs: without onDownload a PDF opens externally on Android';
    if (!android) {
      const inline = await waitFor(
        s,
        (st) => st.url === pdf && idle(st) && st.outcome === 'finished'
      );
      await sleep(500);
      r.check(name, all(inline, h.events.downloads.length === before), {
        state: s.state(),
        downloads: h.events.downloads.slice(before),
      });
    } else if (downloads) {
      await until(
        () => h.events.downloads.length > before && s.state().outcome === 'cancelled',
        15000
      );
      const download = h.events.downloads[before];
      r.since(
        WEBVIEW.navigationListener,
        name,
        all(
          has(download, { mimeType: 'application/pdf', filename: 'shapes.pdf' }),
          stays(s, page),
          s.state().outcome === 'cancelled'
        ),
        { download, state: s.state() }
      );
    } else {
      await until(() => s.external.length > 0, 10000);
      r.check(name, all(s.external.join() === pdf, stays(s, page)), {
        external: s.external,
        url: s.state().url,
      });
    }
  }
}

/** 7. Upload with camera capture (Android's onFileRequest), and a microphone request. */
async function devices({ h, r, s, android }: Shape) {
  if (android) {
    const requests: FileRequest[] = [];
    h.setFileRequest(async (request) => {
      requests.push(request);
      return null;
    });
    await s.open('/media.html');
    await s.tap('capture');
    await until(() => requests.length > 0, 15000);
    r.check(
      'G1 upload: a capture input reaches onFileRequest with capture true',
      all(
        has(requests[0], { multiple: false, capture: true }),
        String(requests[0]?.accept) === 'image/*'
      ),
      requests
    );
  } else r.info('G1 upload: skipped', "iOS shows WebKit's own picker");
  const permissions: PermissionRequest[] = [];
  h.setPermission(async (request) => {
    permissions.push(request);
    return false;
  });
  await s.open('/device.html');
  const mic = String(await lines(s, () => s.click('mic')));
  r.check(
    'G2 permissions: a microphone request names microphone',
    all(
      mic.includes('mic error NotAllowedError'),
      permissions.length === 1,
      String(permissions[0]?.resources) === 'microphone'
    ),
    { mic, permissions }
  );
}

/** 8. SPA: history over pushState and hash entries, and reload on a pushState URL. */
async function spa({ r, s, android }: Shape) {
  await s.use('none');
  // Tapped, as a real SPA's routes are: each goBack steps one entry back.
  const tapped = await walkBack(s, (id) => s.tap(id));
  r.check(
    'H1 spa: goBack() over pushState and hash entries',
    all(
      tapped.pushed.includes('/spa/pushed'),
      tapped.first.url === tapped.pushed,
      tapped.first.agrees,
      tapped.second.url === tapped.start,
      tapped.second.agrees
    ),
    tapped
  );
  // Added by script, without a gesture: Android's goBack, like Chrome's back button, skips those entries and the page
  // that added them (Chromium's history manipulation intervention); WebKit steps back one entry.
  const scripted = await walkBack(s, (id) => s.click(id));
  r.check(
    'H1b spa: goBack() over entries a script added without a gesture',
    scripted.first.url === (android ? scripted.before : scripted.pushed),
    scripted
  );

  await s.open('/spa.html');
  const again = await push(s);
  await s.evaluate('window.__beforeReload = true');
  s.reload();
  const fresh = `window.__beforeReload === undefined && document.querySelector('h1')?.textContent === 'SPA'`;
  const reloaded =
    (await until(
      async () =>
        idle(s.state()) &&
        s.state().outcome === 'finished' &&
        (await s.evaluate(fresh).catch(String)) === true,
      10000
    )) === true;
  r.check(
    'H2 spa: reload() on a pushState URL loads that URL',
    all(again.includes('/spa/pushed'), reloaded, stays(s, again)),
    { pushed: again, reloaded, state: s.state() }
  );
}

/** 8. (cont.) Offline: a failed load shows the example's error screen, and reload() recovers. */
async function offline({ h, r, s }: Shape) {
  const key = `shapes-${Date.now()}`;
  const drop = (fail: 0 | 1) => fetch(`${PAGES}/drop/set?key=${key}&fail=${fail}`);
  try {
    await s.open(`/drop?key=${key}`);
    await drop(1);
    const failedUrl = `${PAGES}/drop?key=${key}&p=2`;
    const errors = h.events.errors.length;
    await s.evaluate(`location.href = '/drop?key=${key}&p=2'`);
    const failed = await waitFor(s, (st) => st.outcome === 'failed' && idle(st));
    const failure = {
      failed,
      error: h.events.errors[errors],
      url: s.state().url,
      screen: (await until(() => h.events.overlay.error, 3000)) === true,
    };
    await drop(0);
    s.reload();
    const recovered = await waitFor(
      s,
      (st) => st.url === failedUrl && idle(st) && st.outcome === 'finished'
    );
    const screenGone = (await until(() => !h.events.overlay.error, 3000)) === true;
    r.check(
      'H3 offline: a failed link shows the error, reload() recovers',
      all(
        failed,
        has(failure.error, { kind: 'network' }),
        failure.url === failedUrl,
        failure.screen,
        recovered,
        screenGone
      ),
      { ...failure, recovered, screenGone, state: s.state() }
    );
  } finally {
    await drop(0);
  }
}

/** 8. (cont.) Android's back button through the app's BackHandler recipe (docs/examples.md). */
async function backButton({ r, s, android }: Shape) {
  if (!android) {
    r.info('H4 android back: skipped', 'iOS has no back button');
    return;
  }
  const first = await s.open('/spa.html?from=first');
  await s.open('/spa.html?from=second');
  const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
    if (!s.state().canGoBack) return false;
    s.goBack();
    return true;
  });
  try {
    await waitFor(s, (st) => st.canGoBack, 3000);
    r.info('BACK', 'the BackHandler recipe');
    r.check(
      'H4 android back: the BackHandler recipe goes back one page',
      await waitFor(s, (st) => st.url === first && idle(st)),
      s.state()
    );
  } finally {
    subscription.remove();
  }
}

/** In run order; the Android taps come in this order too (A4, A5, B6, D1–D5, E10, G1, then the back press). */
const BLOCKS = [
  hybrid,
  frames,
  oauth,
  checkout,
  windows,
  deferredWindows,
  schemes,
  schemeDefaults,
  documents,
  devices,
  spa,
  offline,
  backButton,
];

export async function shapes(h: Harness) {
  const r = reporter('shapes');
  const shape: Shape = { h, r, s: libraryHost(h, r), android: Platform.OS === 'android' };
  for (const block of BLOCKS) await block(shape);
  r.done();
}
