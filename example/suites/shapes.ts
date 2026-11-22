import { BackHandler, Platform } from 'react-native';
import type { FileRequest, NavigationRule, PermissionRequest } from 'react-native-minimal-webview';

import {
  click as scriptClick,
  fresh,
  idle,
  openPage,
  pageLog,
  recordExternal,
  sleep,
  tap,
  touch,
  until,
  waitFor,
  poll,
  happens,
  quietFor,
} from '../harness/helpers';
import { WEBVIEW, type Harness, type Reporter } from '../harness/runner';
import { OTHER, PAGES } from '../pages';

const click = (h: Harness, id: string) => scriptClick(h, id)?.catch(String);

type Policy = 'hybrid' | 'oauth' | 'checkout' | 'windows' | 'schemes' | 'none';

type Shape = {
  h: Harness;
  r: Reporter;
  android: boolean;
  external: string[];
  asked: string[];
};

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

async function applyPolicy(
  s: Shape,
  policy: Policy,
  { external = true, downloads = true, inCheckout = false } = {}
) {
  s.h.setRules(RULES[policy]);
  s.h.setAsk((request) => {
    s.asked.push(request.url);
    if (policy !== 'checkout') return 'block';
    return inCheckout ? 'allow' : 'external';
  });
  s.h.setProps({
    ...(external ? { onOpenExternal: recordExternal(s.external) } : {}),
    ...(downloads ? {} : { onDownload: undefined }),
  });
  await sleep(300);
}
async function open(h: Harness, path: string) {
  const url = fresh(h, path);
  await openPage(h, url);
  return url;
}
function clear(s: Shape) {
  s.external.length = 0;
  s.asked.length = 0;
  s.h.events.navigations.length = 0;
}

export const all = (...conditions: boolean[]) => conditions.every(Boolean);
const has = (value: object | undefined, fields: Record<string, unknown>) =>
  value !== undefined &&
  Object.entries(fields).every(([key, field]) => (value as Record<string, unknown>)[key] === field);

const stays = (h: Harness, url: string) => h.state().url === url;
const decision = (h: Harness, part: string) =>
  h.events.navigations.filter((n) => n.url.includes(part)).at(-1);
const href = async (h: Harness, id: string) =>
  String(await h.ref.current?.evaluate(`document.getElementById(${JSON.stringify(id)}).href`));
const body = (h: Harness) =>
  h.ref.current?.evaluate(`document.getElementById('body')?.textContent ?? ''`).catch(String);
async function hub(s: Shape) {
  const url = await open(s.h, '/shapes.html');
  clear(s);
  return url;
}
async function askAfter(s: Shape, act: () => unknown) {
  clear(s);
  await act();
  await until(() => s.asked.length > 0, 5000);
  await sleep(500);
}
const agrees = async (h: Harness) =>
  (await poll(
    async () => (await h.ref.current?.evaluate('location.href').catch(String)) === h.state().url,
    2000
  )) === true;
async function push(h: Harness) {
  await click(h, 'push');
  await waitFor(h, (st) => st.url.includes('/spa/pushed'), 3000);
  return h.state().url;
}
async function walkBack(h: Harness, act: (id: string) => unknown) {
  const before = await open(h, '/spa.html?from=before');
  const start = await open(h, '/spa.html');
  await act('push');
  await waitFor(h, (st) => st.url.includes('/spa/pushed'), 10000);
  const pushed = h.state().url;
  await act('hash');
  await waitFor(h, (st) => st.url.includes('#h'), 10000);
  const back = async () => {
    const from = h.state().url;
    h.ref.current?.goBack();
    await waitFor(h, (st) => st.url !== from && idle(st), 3000);
    return { url: h.state().url, agrees: await agrees(h) };
  };
  const first = await back();
  return { before, start, pushed, first, second: await back() };
}

async function hybrid(s: Shape) {
  const { h, r } = s;
  await applyPolicy(s, 'hybrid');
  await hub(s);
  await click(h, 'own');
  const own = await happens(
    waitFor(h, (st) => st.url === `${PAGES}/spa.html?from=own` && idle(st))
  );
  r.check(
    'A1 hybrid: an own-site link loads in place',
    all(own, has(decision(h, 'from=own'), { action: 'allow', rule: 0 })),
    { url: h.state().url, decision: decision(h, 'from=own') }
  );

  let page = await hub(s);
  await click(h, 'other');
  await until(() => s.external.length > 0, 3000);
  await sleep(300);
  r.check(
    "A2 hybrid: another site's link goes external, the page stays",
    all(
      s.external.join() === `${OTHER}/spa.html?from=other`,
      has(decision(h, 'from=other'), { action: 'external', rule: 2 }),
      stays(h, page)
    ),
    { external: s.external, decision: decision(h, 'from=other'), url: h.state().url }
  );

  page = await hub(s);
  await click(h, 'offsite');
  await until(() => s.external.length > 0 && h.state().outcome === 'cancelled', 5000);
  r.since(
    WEBVIEW.navigationListener,
    'A3 hybrid: a server redirect off-site goes external',
    all(
      s.external.join() === `${OTHER}/spa.html?from=redirect`,
      stays(h, page),
      h.state().outcome === 'cancelled'
    ),
    { external: s.external, state: h.state() }
  );
}

async function frames(s: Shape) {
  const { h, r, android } = s;
  let page = await hub(s);
  const frameLoads = async () => Number(await h.ref.current?.evaluate('window.frameLoads'));
  const loadsBefore = await frameLoads();
  await tap(h, r, 'frame-other', 'frame');
  const moved = (await poll(async () => (await frameLoads()) > loadsBefore, 15000)) === true;
  await sleep(500);
  const other = decision(h, 'from=frame');
  if (android) r.info('A4 Android decision for the tapped http(s) iframe link', other ?? 'none');
  r.check(
    'A4 hybrid: an iframe link to another site loads in the iframe',
    all(
      moved,
      s.external.length === 0,
      stays(h, page),
      android || has(other, { mainFrame: false, action: 'allow', rule: 1 })
    ),
    { moved, external: s.external, decision: other }
  );

  page = await hub(s);
  const tapped = await pageLog(h, () => tap(h, r, 'frame-tel', 'frame'), 15000);
  await sleep(1000);
  const tel = decision(h, 'tel:+3725550000');
  if (android) r.info('A5 Android decision for the tapped iframe tel:', tel ?? 'none');
  r.check(
    'A5 hybrid: a tel: link inside the iframe is blocked',
    all(
      tapped !== null,
      s.external.length === 0,
      stays(h, page),
      android
        ? !has(tel, { action: 'allow' })
        : has(tel, { mainFrame: false, action: 'block', rule: null })
    ),
    { tapped, external: s.external, decision: tel }
  );
}

async function oauth(s: Shape) {
  const { h, r } = s;
  await applyPolicy(s, 'oauth');
  await hub(s);
  const idp = await href(h, 'login');
  await click(h, 'login');
  r.check(
    'B1 oauth: the IdP page on another origin loads',
    await happens(waitFor(h, (st) => st.url === idp && idle(st))),
    h.state()
  );
  await askAfter(s, () => click(h, 'signin'));
  r.check(
    'B2 oauth: a 302 to the custom scheme is asked with the code, the IdP page stays',
    all(
      s.asked.join() === 'mrwshapes://cb?code=302',
      has(decision(h, 'mrwshapes:'), { action: 'block', rule: 0 }),
      stays(h, idp)
    ),
    { asked: s.asked, decision: decision(h, 'mrwshapes:'), url: h.state().url }
  );
  await askAfter(s, () => h.ref.current?.evaluate(`location.href = 'mrwshapes://cb?code=js'`));
  r.check(
    'B3 oauth: a script redirect to the custom scheme is asked',
    s.asked.join() === 'mrwshapes://cb?code=js',
    s.asked
  );
  const callback = `${PAGES}/shapes-callback`;
  const callbackIdp = await open(
    h,
    `${OTHER}/shapes-idp.html?return=${encodeURIComponent(callback)}`
  );
  await askAfter(s, () => click(h, 'signin'));
  r.check(
    'B4 oauth: a 302 to the callback path is asked and blocked',
    all(s.asked.join() === `${callback}?code=302`, stays(h, callbackIdp)),
    { asked: s.asked, url: h.state().url }
  );
  await askAfter(s, () => open(h, `${OTHER}/shapes-idp.html?auto=1`));
  r.check(
    'B5 oauth: an SSO auto-return on load is asked',
    s.asked.join() === 'mrwshapes://cb?code=auto',
    s.asked
  );
  await hub(s);
  await tap(h, r, 'login-popup');
  const popup = `${OTHER}/shapes-idp.html?popup=1`;
  const popped = await happens(waitFor(h, (st) => st.url === popup && idle(st), 15000));
  const noOpener = await h.ref.current?.evaluate('window.opener === null').catch(String);
  r.check(
    'B6 oauth: a popup login loads in place with no window.opener',
    all(
      popped,
      noOpener === true,
      has(decision(h, 'popup=1'), { newWindow: true, action: 'allow', rule: 2 })
    ),
    { url: h.state().url, noOpener, decision: decision(h, 'popup=1') }
  );
}

async function checkout(s: Shape) {
  const { h, r, android } = s;
  await applyPolicy(s, 'checkout');
  clear(s);
  await open(h, '/shapes-pay.html?mode=frame');
  const paid = await happens(
    waitFor(h, (st) => st.url === `${PAGES}/spa.html?from=paid` && idle(st))
  );
  r.check(
    'C1 checkout: the 3-D Secure iframe completes and the page moves on',
    all(paid, s.asked.length === 0),
    { url: h.state().url, asked: s.asked }
  );
  const acsFrame = h.events.navigations.find((n) => n.url.startsWith(`${OTHER}/shapes-acs.html`));
  if (android)
    r.info(
      'C2 Android: iframe decisions in the 3-D Secure flow',
      h.events.navigations.filter((n) => !n.mainFrame)
    );
  else
    r.check(
      'C2 checkout: the ACS iframe is decided as a subframe',
      has(acsFrame, { mainFrame: false, action: 'allow', rule: 1 }),
      acsFrame
    );

  const term = `${PAGES}/post?term=1`;
  const unruled = () => s.asked.length === 0 && h.events.navigations.length === 0;
  await applyPolicy(s, 'checkout', { inCheckout: true });
  clear(s);
  await open(h, '/shapes-pay.html?mode=top');
  const posted = await happens(waitFor(h, (st) => st.url === term && idle(st)));
  const paRes = await body(h);
  r.check(
    'C3 checkout: a full-page POST to an unlisted bank loads while in checkout',
    all(posted, paRes === 'PaRes=ok', unruled()),
    { url: h.state().url, body: paRes, asked: s.asked, decisions: h.events.navigations }
  );

  await applyPolicy(s, 'checkout', { inCheckout: false });
  clear(s);
  await open(h, '/shapes-pay.html?mode=top');
  await waitFor(h, (st) => st.url === term && idle(st));
  await sleep(500);
  r.check(
    'C4 checkout: the same POST outside checkout',
    all(stays(h, term), s.external.length === 0, unruled()),
    { external: s.external, asked: s.asked, decisions: h.events.navigations, url: h.state().url }
  );
}

async function windows(s: Shape) {
  const { h, r } = s;
  await applyPolicy(s, 'windows');
  let page = await hub(s);
  await tap(h, r, 'blank-own');
  const blank = await happens(
    waitFor(h, (st) => st.url === `${PAGES}/spa.html?from=blank` && idle(st), 15000)
  );
  const blankOwn = decision(h, 'from=blank');
  h.ref.current?.goBack();
  const returned = await happens(waitFor(h, (st) => st.url === page && idle(st), 5000));
  r.check(
    'D1 windows: a same-site target=_blank loads in place, goBack returns to the opener page',
    all(blank, has(blankOwn, { newWindow: true, action: 'allow', rule: 0 }), returned),
    { blank, decision: blankOwn, url: h.state().url }
  );

  page = await hub(s);
  await tap(h, r, 'blank-other');
  await until(() => s.external.length > 0, 15000);
  await sleep(300);
  r.check(
    "D2 windows: another site's target=_blank goes external",
    all(
      s.external.join() === `${OTHER}/spa.html?from=blank-other`,
      has(decision(h, 'blank-other'), { newWindow: true, action: 'external', rule: 1 }),
      stays(h, page)
    ),
    { external: s.external, decision: decision(h, 'blank-other'), url: h.state().url }
  );

  await hub(s);
  await tap(h, r, 'open-own');
  const opened = await happens(
    waitFor(h, (st) => st.url === `${PAGES}/spa.html?from=open` && idle(st), 15000)
  );
  const noOpener = await h.ref.current?.evaluate('window.opener === null').catch(String);
  r.check(
    'D3 windows: a same-site window.open has no window.opener',
    all(opened, noOpener === true),
    { url: h.state().url, noOpener }
  );
}

async function deferredWindows(s: Shape) {
  const { h, r, android } = s;
  await hub(s);
  const log = await pageLog(h, () => tap(h, r, 'open-deferred'), 15000);
  const deferred = `${PAGES}/spa.html?from=deferred`;
  await waitFor(h, (st) => st.url === deferred && idle(st), 8000);
  r.check(
    "D4 windows: window.open('') and a later location",
    all(
      String(log).includes('opened window'),
      stays(h, deferred),
      has(decision(h, 'from=deferred'), { newWindow: true, action: 'allow' })
    ),
    { log, url: h.state().url, decision: decision(h, 'from=deferred') }
  );

  const page = await hub(s);
  if (android) {
    const submitted = await pageLog(h, () => tap(h, r, 'post-blank-submit'), 15000);
    await sleep(3000);
    r.check(
      'D5 windows: a form POST to a new window',
      all(
        submitted !== null,
        stays(h, page),
        !h.events.navigations.some((n) => n.url.includes('/post'))
      ),
      { submitted, url: h.state().url, decisions: h.events.navigations }
    );
    return;
  }
  await tap(h, r, 'post-blank-submit');
  const posted = await happens(
    waitFor(h, (st) => st.url === `${PAGES}/post?from=blank` && idle(st))
  );
  r.check(
    'D5 windows: a form POST to a new window',
    all(posted, !h.events.navigations.some((n) => n.url.includes('/post'))),
    { state: h.state(), decisions: h.events.navigations }
  );
  r.info('D5 iOS: the POST body after it loaded in place', await body(h));
}

async function schemes(s: Shape) {
  const { h, r } = s;
  await applyPolicy(s, 'schemes');
  const page = await hub(s);
  for (const [i, id] of ['tel', 'mailto', 'sms', 'maps', 'market', 'itms', 'intent'].entries()) {
    clear(s);
    const link = await href(h, id);
    await click(h, id);
    await until(() => s.external.length > 0, 3000);
    await quietFor(id === 'intent' ? 1000 : 200);
    r.check(
      `E${i + 1} schemes: ${link.split(':')[0]}: reaches onOpenExternal as written, the page stays`,
      all(
        s.external.join() === link,
        has(h.events.navigations.at(-1), { action: 'external', rule: 0 }),
        stays(h, page)
      ),
      { link, external: s.external, decision: h.events.navigations.at(-1), url: h.state().url }
    );
  }
  clear(s);
  await click(h, 'applink');
  await until(() => decision(h, '/applink/') !== undefined, 3000);
  r.check(
    'E8 schemes: an app-link host rule sends https external',
    all(
      s.external.join() === `${OTHER}/applink/x`,
      has(h.events.navigations.at(-1), { action: 'external', rule: 1 }),
      stays(h, page)
    ),
    { external: s.external, decision: h.events.navigations.at(-1) }
  );
}

async function schemeDefaults(s: Shape) {
  const { h, r, android } = s;
  await applyPolicy(s, 'schemes', { external: false });
  const page = await hub(s);
  await click(h, 'intent');
  await until(() => decision(h, 'intent:') !== undefined, 5000);
  await sleep(1000);
  const intent = { decision: decision(h, 'intent:'), url: h.state().url };
  if (android) r.info('E9 Android: an intent: without onOpenExternal', intent);
  else
    r.check(
      'E9 schemes: without onOpenExternal an intent: is reported block',
      all(has(intent.decision, { action: 'block' }), stays(h, page)),
      intent
    );

  await applyPolicy(s, 'none');
  await hub(s);
  await touch(h, r, 'tel');
  await until(() => decision(h, 'tel:') !== undefined, 15000);
  const main = { external: s.external.join(), decision: h.events.navigations.at(-1) };
  clear(s);
  const tapped = await pageLog(h, () => touch(h, r, 'frame-tel', 'frame'), 15000);
  await sleep(1000);
  const framed = decision(h, 'tel:+3725550000');
  r.check(
    'E10 schemes: with no rules, a tapped tel: goes external from the main frame and is blocked from an iframe',
    all(
      main.external === 'tel:+3725551234',
      has(main.decision, { action: 'external', rule: 2 }),
      tapped !== null,
      s.external.length === 0,
      android
        ? !has(framed, { action: 'allow' })
        : has(framed, { mainFrame: false, action: 'block' })
    ),
    { main, tapped, external: s.external, frame: framed }
  );
}

async function documents(s: Shape) {
  const { h, r, android } = s;
  const pdf = `${PAGES}/shapes.pdf`;
  for (const downloads of [true, false]) {
    await applyPolicy(s, 'none', { downloads });
    const page = await hub(s);
    const before = h.events.downloads.length;
    await click(h, 'pdf');
    const name = downloads
      ? 'F1 docs: a PDF link shows inline on iOS, arrives in onDownload on Android'
      : 'F2 docs: without onDownload a PDF opens externally on Android';
    if (!android) {
      const inline = await happens(
        waitFor(h, (st) => st.url === pdf && idle(st) && st.outcome === 'finished')
      );
      await sleep(500);
      r.check(name, all(inline, h.events.downloads.length === before), {
        state: h.state(),
        downloads: h.events.downloads.slice(before),
      });
    } else if (downloads) {
      await until(
        () => h.events.downloads.length > before && h.state().outcome === 'cancelled',
        15000
      );
      const download = h.events.downloads[before];
      r.since(
        WEBVIEW.navigationListener,
        name,
        all(
          has(download, { mimeType: 'application/pdf', filename: 'shapes.pdf' }),
          stays(h, page),
          h.state().outcome === 'cancelled'
        ),
        { download, state: h.state() }
      );
    } else {
      await until(() => s.external.length > 0, 10000);
      r.check(name, all(s.external.join() === pdf, stays(h, page)), {
        external: s.external,
        url: h.state().url,
      });
    }
  }
}

async function devices(s: Shape) {
  const { h, r, android } = s;
  if (android) {
    const requests: FileRequest[] = [];
    h.setFileRequest(async (request) => {
      requests.push(request);
      return null;
    });
    await open(h, '/media.html');
    await tap(h, r, 'capture');
    await until(() => requests.length > 0, 15000);
    r.check(
      'G1 upload: a capture input reaches onFileRequest with capture true',
      all(
        has(requests[0], { multiple: false, capture: true }),
        String(requests[0]?.accept) === 'image/*'
      ),
      requests
    );
  } else r.skip('G1 upload', "iOS shows WebKit's own picker");
  const permissions: PermissionRequest[] = [];
  h.setPermission(async (request) => {
    permissions.push(request);
    return false;
  });
  await open(h, '/device.html');
  const mic = String(await pageLog(h, () => click(h, 'mic'), 15000));
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

async function spa(s: Shape) {
  const { h, r, android } = s;
  await applyPolicy(s, 'none');
  const tapped = await walkBack(h, (id) => tap(h, r, id));
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
  const scripted = await walkBack(h, (id) => click(h, id));
  r.check(
    'H1b spa: goBack() over entries a script added without a gesture',
    scripted.first.url === (android ? scripted.before : scripted.pushed),
    scripted
  );

  await open(h, '/spa.html');
  const again = await push(h);
  await h.ref.current?.evaluate('window.__beforeReload = true');
  h.ref.current?.reload();
  const fresh = `window.__beforeReload === undefined && document.querySelector('h1')?.textContent === 'SPA'`;
  const reloaded =
    (await poll(
      async () =>
        idle(h.state()) &&
        h.state().outcome === 'finished' &&
        (await h.ref.current?.evaluate(fresh).catch(String)) === true,
      10000
    )) === true;
  r.check(
    'H2 spa: reload() on a pushState URL loads that URL',
    all(again.includes('/spa/pushed'), reloaded, stays(h, again)),
    { pushed: again, reloaded, state: h.state() }
  );
}

async function offline(s: Shape) {
  const { h, r } = s;
  const key = `shapes-${Date.now()}`;
  const drop = (fail: 0 | 1) => fetch(`${PAGES}/drop/set?key=${key}&fail=${fail}`);
  try {
    await open(h, `/drop?key=${key}`);
    await drop(1);
    const failedUrl = `${PAGES}/drop?key=${key}&p=2`;
    const errors = h.events.errors.length;
    await h.ref.current?.evaluate(`location.href = '/drop?key=${key}&p=2'`);
    const failed = await happens(waitFor(h, (st) => st.outcome === 'failed' && idle(st)));
    const failure = {
      failed,
      error: h.events.errors[errors],
      url: h.state().url,
      screen: (await poll(() => h.events.overlay.error, 3000)) === true,
    };
    await drop(0);
    h.ref.current?.reload();
    const recovered = await happens(
      waitFor(h, (st) => st.url === failedUrl && idle(st) && st.outcome === 'finished')
    );
    const screenGone = (await poll(() => !h.events.overlay.error, 3000)) === true;
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
      { ...failure, recovered, screenGone, state: h.state() }
    );
  } finally {
    await drop(0);
  }
}

async function backButton(s: Shape) {
  const { h, r, android } = s;
  if (!android) {
    r.skip('H4 android back', 'iOS has no back button');
    return;
  }
  const first = await open(h, '/spa.html?from=first');
  await open(h, '/spa.html?from=second');
  const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
    if (!h.state().canGoBack) return false;
    h.ref.current?.goBack();
    return true;
  });
  try {
    await waitFor(h, (st) => st.canGoBack, 3000);
    r.drive({ action: 'back' }, 'the BackHandler recipe');
    r.check(
      'H4 android back: the BackHandler recipe goes back one page',
      await happens(waitFor(h, (st) => st.url === first && idle(st))),
      h.state()
    );
  } finally {
    subscription.remove();
  }
}

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

export async function shapes(h: Harness, r: Reporter) {
  const shape: Shape = { h, r, android: Platform.OS === 'android', external: [], asked: [] };
  for (const block of BLOCKS) await r.block(block.name, () => block(shape));
}
