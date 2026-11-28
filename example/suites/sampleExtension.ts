import { Platform } from 'react-native';
import { pageCounter, sampleHook, seams } from 'sample-extension';

import {
  captureWarnings,
  click,
  errorCode,
  failFrom,
  fresh,
  idle,
  openPage,
  recreate,
  sleep,
  text,
  until,
  waitFor,
  waitForLoad,
  poll,
  happens,
} from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';

const SAMPLES_PER_NAVIGATION_KIND = 3;

export async function sampleExtension(h: Harness, r: Reporter) {
  const mountEnds = h.events.documentEnds.length;
  await recreate(h, {}, { remount: true });
  const phantom = h.events.documentEnds.slice(mountEnds).filter((end) => end.url === '');
  r.check('the first commit after mount ends no Document', phantom.length === 0, phantom);
  const misses: unknown[] = [];
  const ends = async (go: () => unknown, to: string, from = h.state().url) => {
    const count = h.events.documentEnds.length;
    await go();
    await waitFor(h, (s) => s.url === to && idle(s) && h.events.documentEnds.length > count, 5000);
    const end = h.events.documentEnds.at(-1);
    if (end?.reason !== 'committed' || end.url !== from) misses.push({ from, end });
  };
  for (let i = 0; i < SAMPLES_PER_NAVIGATION_KIND; i++) {
    const [load, own] = [fresh(h, `/spa.html?load=${i}`), fresh(h, `/spa.html?own=${i}`)];
    await ends(() => h.loadSource({ uri: load }), load);
    await ends(
      () => h.ref.current?.evaluate(`(location.href = '${own}', 1)`).catch(errorCode),
      own
    );
    await ends(() => h.ref.current?.evaluate('(history.back(), 1)').catch(errorCode), load);
  }
  r.check(
    'its onDocumentEnd handler hears each page end as that page: app loads, page navigations, history.back',
    misses.length === 0,
    misses
  );
  const left = await openPage(h, fresh(h, '/spa.html'));
  await failFrom(h, 'spa.html');
  const next = fresh(h, '/spa.html');
  const missed = misses.length;
  await ends(
    () => h.ref.current?.evaluate(`(location.href = '${next}', 1)`).catch(errorCode),
    next,
    left
  );
  r.check(
    'its onDocumentEnd handler hears a page a failed load left on screen end as that page',
    misses.length === missed,
    misses.slice(missed)
  );
  const before = h.events.pageCounts.length;
  h.events.hookEvents.length = 0;
  const previous = h.state().url;
  const page = await openPage(h, fresh(h, '/spa.html'));
  await waitFor(h, () => h.events.pageCounts.at(-1)?.url === page, 5000);
  const event = h.events.pageCounts.at(-1);
  r.check(
    'its delegate gets a callback the core implements too, and emits through onEvent',
    h.events.pageCounts.length > before && event?.url === page,
    event
  );
  const inPage = (await h.ref.current?.evaluate('window.__pageCount')) as number;
  r.check('its native side reaches the page', inPage === event?.count, { inPage, event });
  const ended = h.events.documentEnds.at(-1);
  r.check(
    'its onDocumentEnd handler hears the old page end, and context.url there is still that page',
    ended?.reason === 'committed' && ended.url === previous,
    { ended, previous }
  );
  const count = await h.ref.current?.hook('sample.pageCounter', 'count').catch(errorCode);
  r.check('ref.hook resolves with the reply of its handler', count === inPage, { count, inPage });
  const label = await h.ref.current?.hook('sample.pageCounter', 'label').catch(errorCode);
  r.check(
    "its ask waits for the app's answer (onEvent's return value)",
    label === `page ${inPage}`,
    { label, inPage }
  );
  const unhandled = [
    await h.ref.current?.hook('sample.pageCounter', 'nope').catch(errorCode),
    await h.ref.current?.hook('noSuchHook', 'count').catch(errorCode),
  ];
  r.check(
    'ref.hook rejects with not_found when no attached hook handles the method',
    unhandled.every((code) => code === 'not_found'),
    unhandled
  );
  const url = h.state().url;
  const loads = h.events.loads.length;
  await h.ref.current?.evaluate('window.__kept = true');
  h.setProps({
    extensions: [
      pageCounter(
        { global: '__liveCount' },
        ({ name }) => void h.events.hookEvents.push(`sample.pageCounter.${name}`)
      ),
    ],
    withoutPageCounter: true,
  });
  const live = await poll(
    async () => (await h.ref.current?.evaluate('window.__liveCount')) === inPage,
    3000
  );
  const kept = await h.ref.current?.evaluate('window.__kept');
  r.check(
    'an options change reaches its hook live, without recreating the WebView or reloading the page',
    !!live && kept === true && h.state().url === url && h.events.loads.length === loads,
    { live, kept, url: h.state().url, newLoads: h.events.loads.length - loads }
  );
  const failed = await h.ref.current?.hook('sample.pageCounter', 'label').catch(errorCode);
  r.check('reply.fail rejects ref.hook with handler_error', failed === 'handler_error', failed);
  h.setProps({});
  if (Platform.OS === 'ios') {
    h.loadSource({ uri: `${h.pages}/redirect?to=${encodeURIComponent('/spa.html?from=hook')}` });
    await waitFor(h, (s) => s.url.includes('from=hook') && idle(s));
    r.check(
      'a callback the core does not implement is forwarded to its delegate (didReceiveServerRedirect)',
      await happens(
        waitFor(h, () => h.events.hookEvents.includes('sample.pageCounter.redirect'), 3000)
      ),
      h.events.hookEvents
    );
  } else {
    r.check(
      'a callback the core does not implement is forwarded to its client (onPageCommitVisible)',
      await happens(
        waitFor(h, () => h.events.hookEvents.includes('sample.pageCounter.commitVisible'), 3000)
      ),
      h.events.hookEvents
    );
  }
  h.setProps({
    extensions: [pageCounter(true, () => new Promise<never>(() => {}))],
    withoutPageCounter: true,
  });
  await sleep(100);
  const held = h.ref.current?.hook('sample.pageCounter', 'label').catch(errorCode);
  await sleep(200);
  await recreate(h, {}, { remount: true });
  const unmounted = await Promise.race([held, sleep(3000).then(() => 'still pending')]);
  r.check(
    'unmount rejects a ref.hook in flight with navigated',
    unmounted === 'navigated',
    unmounted
  );
  await recreate(h, {}, { remount: true });
  h.setProps({ extensions: [sampleHook('hookAuth')] });
  await openPage(h, fresh(h, '/auth?hook=1'));
  const auth = await text(h, 'auth');
  r.check(
    'a key turned on after creation attaches its hook: its delegate answers HTTP auth',
    auth === 'authorized',
    auth
  );
  await recreate(
    h,
    { extensions: [sampleHook('hookAuth')], withoutPageCounter: true },
    { remount: true }
  );
  const warnings = captureWarnings();
  try {
    h.setProps({ extensions: [sampleHook('hookAuth'), pageCounter()], withoutPageCounter: true });
    await until(() => warnings.warned('extension sample.pageCounter'), 3000, 100);
  } finally {
    warnings.stop();
  }
  const late = await h.ref.current?.hook('sample.pageCounter', 'count').catch(errorCode);
  r.check(
    'a key turned on after creation whose hook has configure warns and attaches nothing',
    late === 'not_found' && warnings.warned('attaches only when the WebView is created'),
    { late, warnings: warnings.lines }
  );
  const taking =
    Platform.OS === 'ios'
      ? 'webView:decidePolicyForNavigationAction:decisionHandler:: a hook delegate'
      : 'shouldOverrideUrlLoading: a hook client';
  const taken = `${taking} takes it, so navigationRules, their defaults and onNavigationRequest don't apply to navigations`;
  const takenWarnings = captureWarnings();
  try {
    await recreate(h, { extensions: [sampleHook('hookNavigation')] }, { remount: true });
    for (const n of [1, 2]) {
      const to = fresh(h, `/spa.html?taken=${n}`);
      await h.ref.current?.evaluate(`(location.href = '${to}', 1)`).catch(errorCode);
      await waitFor(h, (s) => s.url === to && idle(s), 5000);
    }
    await until(() => takenWarnings.warned(taken), 3000, 100);
  } finally {
    takenWarnings.stop();
  }
  const takenLines = takenWarnings.lines.filter((line) => line.includes(taken));
  r.check(
    'a hook that takes the navigation decision warns once that the navigation rules do not apply',
    takenLines.length === 1,
    takenWarnings.lines
  );
  await recreate(
    h,
    { extensions: [sampleHook('hookDialogs'), sampleHook('subclass')] },
    { remount: true }
  );
  const made = await h.ref.current?.hook('sample.subclass', 'class').catch(errorCode);
  r.check(
    "its webViewClass (webViewFactory) makes the WebView it's enabled on",
    made === (Platform.OS === 'ios' ? 'SampleWKWebView' : 'SampleWebView'),
    made
  );
  h.events.hookEvents.length = 0;
  const after = await h.ref.current?.evaluate(`(alert('from the page'), 'after')`).catch(errorCode);
  await until(() => h.events.hookEvents.includes('sample.hookDialogs.alert'), 3000, 100);
  r.check(
    'its UI delegate takes over a dialog the core implements (alert), with no dialog shown',
    after === 'after' && h.events.hookEvents.includes('sample.hookDialogs.alert'),
    { after, hookEvents: h.events.hookEvents }
  );
  await recreate(h, {}, { remount: true });
  h.loadSource({
    html: '<p id="n">Call 415-555-0134 today</p><code id="c">x</code>',
    baseUrl: h.pages,
  });
  const configured =
    Platform.OS === 'ios'
      ? "document.querySelector('#n a[href^=tel]') !== null"
      : "(c => c !== null && getComputedStyle(c).fontSize === '14px')(document.getElementById('c'))";
  const applied = async () => (await h.ref.current?.evaluate(configured)) === true;
  r.check('its configure hook sets the WebView up', !!(await poll(applied, 5000, 250)));
  if (Platform.OS === 'android') {
    await seams.setWebViewMissing(true);
    const errors = h.events.errors.length;
    let reloaded = false;
    try {
      h.setProps({ extensions: [sampleHook('noWebView')] });
      h.remount();
      await until(() => h.events.errors.length > errors, 3000);
      await seams.setWebViewMissing(false);
      reloaded = await happens(waitForLoad(h, () => h.ref.current?.reload(), idle, 10000));
    } finally {
      await seams.setWebViewMissing(false);
    }
    const reported = h.events.errors.slice(errors);
    r.check(
      'a WebView that cannot be made (no WebView provider) reports onError, and reload() makes it and loads',
      reported.length === 1 &&
        reported[0]?.kind === 'network' &&
        reported[0].code === -1 &&
        reloaded &&
        h.events.outcomes.at(-1) === 'finished',
      { reported, reloaded, outcome: h.events.outcomes.at(-1) }
    );
  } else
    r.skip(
      'a WebView that cannot be made (no WebView provider) reports onError, and reload() makes it and loads',
      'iOS has no WebView provider to be missing'
    );
  await r.block('hookSeams', () => hookSeams(h, r));
}

async function hookSeams(h: Harness, r: Reporter) {
  await recreate(h, { extensions: [sampleHook('seams')] }, { remount: true });
  const twice = await h.ref.current?.hook('sample.seams', 'twice', [21]).catch(errorCode);
  r.check('its handle handler reads a whole JS number as a Double', twice === 42, twice);
  if (Platform.OS === 'ios') {
    const tinted = await h.ref.current?.hook('sample.seams', 'tint').catch(errorCode);
    r.check(
      'its refreshControl, styled at attach, is the one pullToRefresh shows',
      tinted === true,
      tinted
    );
    r.skip(
      'its download, touch and scroll seams',
      'onDownloadStart and the touch and scroll listeners are Android seams'
    );
  } else {
    r.skip(
      'its refreshControl, styled at attach, is the one pullToRefresh shows',
      'refreshControl is an iOS seam'
    );
    await openPage(h, fresh(h, '/media.html'));
    const [downloads, events] = [h.events.downloads.length, h.events.hookEvents.length];
    await click(h, 'attachment');
    const taken = await poll(
      () => h.events.hookEvents.slice(events).includes('sample.seams.download'),
      10000
    );
    await click(h, 'blob');
    const passed = await happens(waitFor(h, () => h.events.downloads.length > downloads, 20000));
    r.check(
      'its onDownloadStart handler takes an http download from onDownload and passes a blob: one on',
      !!taken && passed && h.events.downloads.length === downloads + 1,
      { taken, downloads: h.events.downloads.length - downloads }
    );
    const touches = await h.ref.current?.hook('sample.seams', 'touch').catch(errorCode);
    r.check('its touch listeners share the slot, in order', touches === 2, touches);
    h.loadSource({ html: '<div style="height: 5000px">tall</div>', baseUrl: h.pages });
    const scrolled = await poll(
      async () => (await h.ref.current?.evaluate('(scrollTo(0, 400), scrollY > 0)')) === true,
      5000
    );
    const both = await poll(
      () =>
        ['scrollA', 'scrollB'].every((name) =>
          h.events.hookEvents.includes(`sample.seams.${name}`)
        ),
      3000
    );
    r.check(
      'its two scroll listeners both get the scroll',
      !!scrolled && !!both,
      h.events.hookEvents
    );
  }
  const closed = await seams.closedViews();
  await recreate(h, {}, { remount: true });
  const now = await poll(async () => {
    const count = await seams.closedViews();
    return count > closed && count;
  }, 3000);
  r.check(
    'its onDestroyed handler runs once its WebView is closed at unmount',
    now === closed + 1,
    { closed, now }
  );
}
