import { Platform } from 'react-native';
import type { NavigationRule, WebViewProps } from 'react-native-minimal-webview';

import {
  click,
  errorCode,
  fresh,
  idle,
  openPage,
  poll,
  recordExternal,
  sleep,
  tap,
  until,
  waitFor,
  happens,
  quietFor,
} from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';

export async function navigation(h: Harness, r: Reporter) {
  const external: string[] = [];
  const asked: string[] = [];
  const newWindowAsks: string[] = [];
  let lastAskAt = 0;
  const lastNavigation = () => h.events.navigations[h.events.navigations.length - 1];
  const decisionOf = (url: string) => h.events.navigations.find((n) => n.url === url);
  h.setProps({
    onOpenExternal: recordExternal(external),
  });
  h.setAsk((request) => {
    asked.push(request.url);
    if (request.newWindow) newWindowAsks.push(request.url);
    lastAskAt = Date.now();
    return 'allow';
  });
  h.setRules([
    { scheme: ['tel', 'mailto', 'sms'], action: 'external' },
    { host: ['localhost'], path: ['/checkout'], action: 'ask' },
    { host: ['localhost'], newWindow: true, path: ['/spa'], action: 'allow' },
    { newWindow: true, action: 'external' },
    { host: ['localhost', '127.0.0.1'], action: 'allow' },
    { scheme: ['http', 'https'], mainFrame: false, action: 'allow' },
    { scheme: ['http', 'https'], action: 'external' },
  ]);
  await sleep(500);
  const page = fresh(h, '/nav.html');
  await openPage(h, page);
  h.events.navigations.length = 0;
  const noLoad = async (name: string, act: () => Promise<unknown>) => {
    const [loads, outcome] = [h.events.loads.length, h.state().outcome];
    await act();
    await sleep(500);
    const added = h.events.loads.slice(loads);
    r.check(`${name} reports no load`, !added.includes('start') && h.state().outcome === outcome, {
      added,
      outcome: h.state().outcome,
      was: outcome,
    });
  };

  await noLoad('a tapped tel: link', async () => {
    await click(h, 'tel');
    await waitFor(h, () => lastNavigation() !== undefined, 3000);
  });
  r.check('tel: goes to onOpenExternal', external[0] === 'tel:+3725551234', external);
  r.check(
    'onNavigation reports the external decision and rule',
    lastNavigation()?.action === 'external' && lastNavigation()?.rule === 0,
    lastNavigation()
  );
  r.check('the page stays', h.state().url === page, h.state());

  await noLoad('an external link', async () => {
    await click(h, 'external');
    await waitFor(h, () => external.length > 1, 3000);
  });
  r.check(
    'an outside main-frame link goes external',
    external[1] === 'https://example.com/',
    external
  );

  await tap(h, r, 'open');
  await waitFor(h, () => lastNavigation()?.url === 'https://example.com/popup', 15000);
  r.check(
    'a tapped window.open to another site goes external (newWindow)',
    external[2] === 'https://example.com/popup',
    external
  );
  r.check(
    'onNavigation marks it as a new window',
    lastNavigation()?.newWindow === true,
    lastNavigation()
  );

  await tap(h, r, 'blank');
  const inPlace = await happens(waitFor(h, (s) => s.url.endsWith('/spa.html') && idle(s), 15000));
  r.check('a tapped target=_blank allowed by a newWindow rule loads in place', inPlace, h.state());

  const mailto = 'mailto:test@example.com';
  await openPage(h, fresh(h, '/nav.html'));
  h.events.navigations.length = 0;
  external.length = 0;
  await click(h, 'mailto');
  await waitFor(h, () => decisionOf(mailto) !== undefined, 3000);
  const sameWindow = decisionOf(mailto);
  h.events.navigations.length = 0;
  await noLoad('a tapped target=_blank mailto:', async () => {
    await tap(h, r, 'blank-mailto');
    await waitFor(h, () => decisionOf(mailto) !== undefined, 15000);
  });
  const newWindow = decisionOf(mailto);
  r.check(
    'a tapped target=_blank mailto: goes to onOpenExternal as a new window, as a same-window one does',
    external.length === 2 &&
      external.every((url) => url === mailto) &&
      sameWindow?.action === 'external' &&
      newWindow?.action === 'external' &&
      newWindow.rule === sameWindow.rule &&
      newWindow.newWindow,
    { external, sameWindow, newWindow }
  );

  await tap(h, r, 'blank-checkout');
  const askedInPlace = await happens(
    waitFor(h, (s) => s.url.endsWith('/checkout/window') && idle(s), 15000)
  );
  r.check(
    'a new window an ask rule matches is asked with newWindow true, and loads in place when allowed',
    askedInPlace && newWindowAsks.some((url) => url.endsWith('/checkout/window')),
    { state: h.state(), newWindowAsks }
  );

  const selfOpening = (name: string) => ({
    html: `<script>setTimeout(() => { window.open('https://example.com/${name}'); window.__opened = true; }, 300)</script>`,
    baseUrl: h.pages,
  });
  h.loadSource(selfOpening('blocked'));
  await until(
    async () => (await h.ref.current?.evaluate('window.__opened').catch(errorCode)) === true,
    5000
  );
  await quietFor(1000);
  r.check(
    'by default a script cannot open a window without a gesture',
    !external.includes('https://example.com/blocked'),
    external
  );
  h.setProps({
    onOpenExternal: recordExternal(external),
    ios: { preferences: { javaScriptCanOpenWindowsAutomatically: true } },
    android: { settings: { javaScriptCanOpenWindowsAutomatically: true } },
  });
  const optIn = `${Platform.OS === 'ios' ? 'preferences' : 'settings'}.javaScriptCanOpenWindowsAutomatically`;
  await until(async () => (await h.ref.current?.get(optIn).catch(errorCode)) === true, 3000);
  h.loadSource(selfOpening('opted-in'));
  await waitFor(h, () => external.includes('https://example.com/opted-in'), 5000);
  r.check(
    'javaScriptCanOpenWindowsAutomatically lets it, through the newWindow rules',
    external.includes('https://example.com/opted-in'),
    external
  );
  const deferred = 'https://example.com/deferred';
  h.loadSource({
    html: `<script>setTimeout(() => { const w = window.open(''); setTimeout(() => { w.location.href = '${deferred}'; }, 300); }, 300)</script>`,
    baseUrl: h.pages,
  });
  await waitFor(h, () => decisionOf(deferred) !== undefined, 8000);
  r.check(
    "window.open('') then a location the rules send external goes to onOpenExternal as a new window",
    external.includes(deferred) &&
      decisionOf(deferred)?.action === 'external' &&
      decisionOf(deferred)?.newWindow === true,
    { external, decision: decisionOf(deferred) }
  );
  await openPage(h, fresh(h, '/nav.html'));
  if (Platform.OS === 'ios') {
    await click(h, 'redirect', 'frame')?.catch(errorCode);
    const frameUrl = () =>
      h.ref.current?.evaluate(`document.getElementById('frame').contentWindow.location.href`);
    await until(
      async () => String(await frameUrl()?.catch(errorCode)).includes('from=redirect'),
      5000
    );
    await until(() => h.events.navigations.some((n) => !n.mainFrame && n.action === 'allow'), 3000);
    const frames = h.events.navigations.filter((n) => !n.mainFrame);
    r.check(
      'iframe navigations are decided as mainFrame false',
      frames.some((n) => n.action === 'allow'),
      frames.slice(0, 3)
    );
  }

  asked.length = 0;
  await h.ref.current?.evaluate(`location.href = '/checkout/loopA'`);
  const askedAThirdTime = () => asked.length > 2;
  const loopEndedWithoutAnotherAsk = () =>
    asked.length > 0 && idle(h.state()) && Date.now() - lastAskAt > 1000;
  await until(() => askedAThirdTime() || loopEndedWithoutAnotherAsk(), 10000);
  r.check(
    'an ask redirect loop asks at most once per URL',
    asked.length >= 1 && asked.length <= 2,
    asked
  );
  await openPage(h, fresh(h, '/nav.html'));

  const askedPage = h.state().url;
  const decided = (path: string) =>
    waitFor(h, () => lastNavigation()?.url.endsWith(path) === true, 3000);
  h.setAsk(() => 'external');
  await noLoad('an ask answered external', async () => {
    await h.ref.current?.evaluate(`location.href = '/checkout/external'`);
    await decided('/checkout/external');
  });
  r.check(
    'an ask answered external goes to onOpenExternal',
    lastNavigation()?.action === 'external' &&
      external.some((url) => url.endsWith('/checkout/external')),
    { navigation: lastNavigation(), external }
  );
  h.setAsk(() => 'deny' as unknown as 'block');
  await noLoad('a blocked location.href', async () => {
    await h.ref.current?.evaluate(`location.href = '/checkout/invalid'`);
    await decided('/checkout/invalid');
  });
  r.check('an invalid ask answer blocks', lastNavigation()?.action === 'block', lastNavigation());
  r.check('the page stays after both', h.state().url === askedPage, h.state());

  h.setProps({});
  h.setRules([{ scheme: ['nosuchapp'], action: 'external' }]);
  await sleep(500);
  await h.ref.current?.evaluate(`location.href = 'nosuchapp://x'`);
  await waitFor(h, () => lastNavigation()?.url === 'nosuchapp://x', 5000);
  r.check(
    'an external URL nothing opens is reported as block',
    lastNavigation()?.action === 'block',
    lastNavigation()
  );

  h.setRules([
    { scheme: ['intent', 'tel'], action: 'external' },
    { scheme: ['http', 'https'], action: 'allow' },
  ]);
  const scheme = Platform.OS === 'android' ? 'intent:' : 'tel:';
  const sendExternal = async (from: string, onOpenExternal?: WebViewProps['onOpenExternal']) => {
    h.setProps(onOpenExternal ? { onOpenExternal } : {});
    await sleep(500);
    external.length = 0;
    h.events.navigations.length = 0;
    const fallback = `${h.pages}/spa.html?from=${from}`;
    const url =
      Platform.OS === 'android'
        ? `intent://nothing/#Intent;scheme=nothere;package=com.example.notinstalled;S.browser_fallback_url=${encodeURIComponent(fallback)};end`
        : 'tel:+3725551234';
    await h.ref.current?.evaluate(`location.href = ${JSON.stringify(url)}`);
    const decided = (prefix: string) => h.events.navigations.find((n) => n.url.startsWith(prefix));
    await waitFor(h, () => decided(scheme) !== undefined, 5000);
    const timeForADecidedFallbackToLoad = decided(fallback) ? 8000 : 1000;
    const loaded = await happens(
      waitFor(h, (s) => s.url === fallback && idle(s), timeForADecidedFallbackToLoad)
    );
    return {
      external: [...external],
      decision: decided(scheme),
      fallback: decided(fallback),
      loaded,
    };
  };
  if (Platform.OS === 'android') {
    const own = await sendExternal('fallback');
    r.check('intent: without an app loads browser_fallback_url', own.loaded, own);
    r.check('the intent: itself is reported as block', own.decision?.action === 'block', own);
  }
  const handedBack = await sendExternal('handed-back', ({ url }) => {
    external.push(url);
    return false;
  });
  r.check(
    Platform.OS === 'android'
      ? 'onOpenExternal returning false hands an intent: back: its fallback loads through the rules, it is reported block'
      : 'onOpenExternal returning false hands tel: back to the OS, which opens nothing on a simulator: block',
    handedBack.external.length === 1 &&
      handedBack.decision?.action === 'block' &&
      (Platform.OS === 'ios' || (handedBack.loaded && handedBack.fallback?.rule === 1)),
    handedBack
  );
  const handled = await sendExternal('handled', ({ url }) => {
    external.push(url);
    return true;
  });
  r.check(
    'onOpenExternal returning true has opened it: reported external, no fallback',
    handled.external.length === 1 &&
      handled.decision?.action === 'external' &&
      handled.fallback === undefined &&
      !handled.loaded,
    handled
  );

  const internalFrames = async (label: string, rules: NavigationRule[], kinds: string[]) => {
    h.setProps({ onOpenExternal: recordExternal(external) });
    h.setRules(rules);
    await sleep(500);
    const top = fresh(h, '/nav.html');
    await openPage(h, top);
    external.length = 0;
    h.events.navigations.length = 0;
    await h.ref.current?.evaluate(`(() => {
      window.__frames = [];
      addEventListener('message', (e) => window.__frames.push(e.data));
      const run = (name) => '<script>parent.postMessage(' + JSON.stringify(name) + ', "*")</' + 'script>';
      const add = (set) => { const f = document.createElement('iframe'); set(f); document.body.append(f); };
      add((f) => { f.src = 'about:blank'; f.onload = () => f.contentWindow.eval(\`parent.postMessage('about:blank', '*')\`); });
      add((f) => { f.srcdoc = run('srcdoc'); });
      add((f) => { f.src = 'data:text/html,' + encodeURIComponent(run('data:')); });
      if (${kinds.includes('blob:')}) add((f) => { f.src = URL.createObjectURL(new Blob([run('blob:')], { type: 'text/html' })); });
    })()`);
    const ran = async () => (await h.ref.current?.evaluate('window.__frames')) as string[];
    await poll(async () => {
      const seen = await ran();
      return kinds.every((kind) => seen.includes(kind));
    }, 5000);
    await quietFor(500);
    const seen = await ran();
    r.check(
      `${label}: ${kinds.join(', ')} iframes load and run`,
      kinds.every((kind) => seen.includes(kind)),
      seen
    );
    const refused = h.events.navigations.filter(
      (n) => !/^https?:/.test(n.url) && n.action !== 'allow'
    );
    r.check(
      `${label}: none of them is opened externally or blocked, and the page stays`,
      external.length === 0 && refused.length === 0 && h.state().url === top,
      { external, refused, url: h.state().url }
    );
  };
  await internalFrames(
    'under a catch-all external rule',
    [{ host: ['localhost', '127.0.0.1'], action: 'allow' }, { action: 'external' }],
    ['about:blank', 'srcdoc', 'data:', 'blob:']
  );
  await internalFrames('with navigationRules={[]}', [], ['about:blank', 'srcdoc', 'data:']);
}
