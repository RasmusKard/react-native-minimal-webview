import {
  type CustomMenuSelectionEvent,
  type Dialog,
  type ScrollEvent,
  type SubResourceErrorEvent,
  androidLayerType,
  basicAuthCredential,
  dialogs as dialogsExtension,
  downloadManager,
  hideKeyboardAccessoryView,
  incognito,
  keyboardDisplayRequiresUserAction,
  menuItems,
  nestedScrollEnabled,
  onLoadSubResourceError,
  onScroll,
  refreshControlLightMode,
  removeIosKeyboardObserver,
  transparentBackground,
} from '@react-native-minimal-webview/extensions';
import { Platform } from 'react-native';
import { AndroidConstants, IOSConstants } from 'react-native-minimal-webview';
import { sampleHook } from 'sample-extension';

import {
  captureWarnings,
  errorCode,
  fresh,
  openPage,
  pageLog,
  recreate,
  sleep,
  text,
  until,
  waitForLoad,
  poll,
  happens,
  clickWithoutWaiting,
  touch,
} from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';
import { HTTPS, OTHER, PAGES_PORT } from '../pages';

const KEY = '@react-native-minimal-webview/extensions';
const ios = Platform.OS === 'ios';
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const MENU = [{ label: 'Highlight', key: 'hl' }];
const ONE_WORD_OVER_THE_PAGE = `<p style="font: 48px/1.2 system-ui; word-break: break-all; margin: 0">${'a'.repeat(3000)}</p>`;

async function loadHtml(h: Harness, body: string) {
  const title = `ext-${Date.now()}`;
  h.loadSource({
    html: `<!doctype html>${VIEWPORT}<title>${title}</title>${body}`,
    baseUrl: h.pages,
  });
  return !!(await poll(
    async () => (await h.ref.current?.evaluate('document.title').catch(errorCode)) === title,
    10000
  ));
}

const webViewClass = async (h: Harness) =>
  await h.ref.current?.call(ios ? 'webView.description' : 'webView.toString').catch(errorCode);

const switchedOffOnScroll = { key: `${KEY}.onScroll`, options: null };
const strayEvents = (h: Harness) => h.events.hookEvents.filter((name) => name.startsWith(KEY));

export async function extensions(h: Harness, r: Reporter) {
  const warnings = captureWarnings();
  try {
    await r.block('inert', () => inert(h, r));
    await r.block('auth', () => auth(h, r));
    await r.block('dialogs', () => dialogs(h, r, warnings));
    await r.block('scroll', () => scroll(h, r));
    await r.block('menu', () => menu(h, r, warnings));
    await r.block('background', () => background(h, r));
    await r.block('privacy', () => privacy(h, r));
    await (ios
      ? r.block('keyboard', () => keyboard(h, r))
      : r.block('android', () => android(h, r)));
    const stray = warnings.lines.filter(
      (line) =>
        line.includes(`extension ${KEY}.`) &&
        !line.includes(`${KEY}.menuItems`) &&
        !line.includes(`${KEY}.incognito: its hook has`)
    );
    r.check(
      'no extension key warns: each is registered, and sent only on its platforms',
      stray.length === 0,
      stray
    );
  } finally {
    warnings.stop();
  }
}

// Browsers reuse an origin's credentials for any realm, and other suites sign in on localhost: the declines use an origin
// nobody signs in on, and the sign-in one of its own (the emulator's host alias, the simulator's IPv6 loopback).
const DECLINED = OTHER;
const SIGNED_IN = `http://${ios ? '[::1]' : '10.0.2.2'}:${PAGES_PORT}`;

async function inert(h: Harness, r: Reporter) {
  await recreate(h, { extensions: [switchedOffOnScroll] }, { remount: true });
  const made = await webViewClass(h);
  r.check(
    "with no extension, the WebView isn't made from the menu hook's class",
    typeof made === 'string' && !made.includes('MenuW'),
    made
  );
  await openPage(h, fresh(h, `${DECLINED}/auth?t=ext-none`));
  const auth = await text(h, 'auth');
  r.check(
    'with no extension, HTTP auth is declined as the core does',
    auth === 'unauthorized',
    auth
  );
  h.events.hookEvents.length = 0;
  await loadHtml(h, '<div style="height: 5000px">tall</div>');
  await h.ref.current?.evaluate('scrollTo(0, 400)');
  await sleep(1000);
  r.check(
    'with no extension, no extension hook sends an event: a scroll sends none',
    strayEvents(h).length === 0,
    strayEvents(h)
  );
}

async function auth(h: Harness, r: Reporter) {
  h.setProps({ extensions: [basicAuthCredential({ username: 'u', password: 'p' })] });
  await sleep(300);
  await openPage(h, fresh(h, `${SIGNED_IN}/auth?t=ext-on`));
  const on = await text(h, 'auth');
  r.check('basicAuthCredential, set after mount, answers HTTP basic auth', on === 'authorized', on);
  h.setProps({});
  await sleep(300);
  await openPage(h, fresh(h, `${DECLINED}/auth?t=ext-removed`));
  const off = await text(h, 'auth');
  r.check(
    'basicAuthCredential switched off: HTTP auth is declined again',
    off === 'unauthorized',
    off
  );
  h.setProps({ extensions: [basicAuthCredential({ username: 'u', password: 'wrong' })] });
  await sleep(300);
  await happens(openPage(h, fresh(h, `${DECLINED}/auth?t=ext-wrong`)));
  const wrong = await text(h, 'auth');
  r.check(
    'basicAuthCredential with a rejected credential stops: the 401 page shows',
    wrong === 'unauthorized',
    wrong
  );
  h.setProps({});
  await sleep(300);
  if (!ios) return;
  const asked: unknown[] = [];
  h.setProps({
    extensions: [
      basicAuthCredential({ username: 'u', password: 'wrong' }),
      { ...sampleHook('hookAuth'), onEvent: ({ payload }) => void asked.push(payload) },
    ],
  });
  await sleep(300);
  await openPage(h, fresh(h, '/auth?chain=1'));
  const chained = await text(h, 'auth');
  r.check(
    "a challenge basicAuthCredential passes on reaches a later hook's delegate, which signs in",
    asked.length > 0 && chained === 'authorized',
    { asked, chained }
  );
  h.setProps({});
}

async function dialogs(h: Harness, r: Reporter, warnings: ReturnType<typeof captureWarnings>) {
  const seen: Dialog[] = [];
  h.setProps({
    extensions: [
      dialogsExtension((dialog) => {
        seen.push(dialog);
        return dialog.type === 'prompt' ? 'typed' : true;
      }),
    ],
  });
  await openPage(h, fresh(h, '/dialogs.html'));
  for (const [id, expected] of [
    ['alert', 'alert closed'],
    ['confirm', 'confirm true'],
    ['prompt', 'prompt typed'],
  ] as const) {
    const lines = await pageLog(h, () => clickWithoutWaiting(h, id));
    r.check(
      `onDialog answers the ${id}, and the page gets the answer`,
      lines?.join() === expected,
      lines
    );
  }
  const got = seen.map((dialog) => [
    dialog.type,
    dialog.message,
    'defaultValue' in dialog ? dialog.defaultValue : '-',
    dialog.mainFrame ?? '-',
  ]);
  const frame = ios ? true : '-';
  r.check(
    "onDialog gets each dialog's type, message, a prompt's default text and, on iOS, mainFrame",
    JSON.stringify(got) ===
      JSON.stringify([
        ['alert', 'hello', '-', frame],
        ['confirm', 'ok?', '-', frame],
        ['prompt', 'name?', 'default', frame],
      ]),
    seen
  );
  let hold = true;
  let aborted = false;
  h.setProps({
    extensions: [
      dialogsExtension((_, signal) => {
        if (!hold) return true;
        signal.addEventListener('abort', () => (aborted = true));
        return new Promise(() => {});
      }),
    ],
  });
  await openPage(h, fresh(h, '/dialogs.html'));
  clickWithoutWaiting(h, 'alert');
  await sleep(1000);
  const remounted = await happens(waitForLoad(h, () => h.remount()));
  hold = false;
  await openPage(h, fresh(h, '/dialogs.html'));
  const next = await pageLog(h, () => clickWithoutWaiting(h, 'confirm'));
  r.check(
    "an unmount while onDialog hasn't answered aborts its signal, and the next dialog is answered",
    remounted && aborted && next?.join() === 'confirm true',
    { remounted, aborted, next }
  );
  h.setProps({ extensions: [dialogsExtension(() => true), sampleHook('hookDialogs')] });
  await sleep(300);
  void h.ref.current?.evaluate("setTimeout(() => alert('two hooks'), 0)");
  const alert = ios ? 'webView:runJavaScriptAlertPanelWithMessage:' : 'onJsAlert:';
  await until(() => warnings.warned(alert), 3000);
  r.check(
    'an alert two hooks take warns that only the first one gets it',
    warnings.lines.some(
      (line) => line.includes(alert) && line.includes('only the first one gets it')
    ),
    warnings.lines
  );
  h.setProps({});
}

async function scroll(h: Harness, r: Reporter) {
  const scrolls: ScrollEvent[] = [];
  const noInsetAdjustment = {
    scrollView: {
      contentInsetAdjustmentBehavior: IOSConstants.ContentInsetAdjustmentBehavior.never,
    },
  };
  h.setProps({
    ios: noInsetAdjustment,
    extensions: [onScroll((event) => scrolls.push(event))],
  });
  await loadHtml(h, '<div style="height: 5000px">tall</div>');
  await h.ref.current?.evaluate('scrollTo(0, 400)');
  const at = await poll(
    () => scrolls.find(({ contentOffset }) => Math.abs(contentOffset.y - 400) < 1),
    3000
  );
  r.check(
    'onScroll, set after mount, gets the offset, and a content size taller than the view',
    !!at && at.contentSize.height > at.layoutMeasurement.height,
    scrolls.at(-1)
  );
  h.setProps({ ios: noInsetAdjustment, extensions: [switchedOffOnScroll] });
  await sleep(300);
  const count = scrolls.length;
  h.events.hookEvents.length = 0;
  await h.ref.current?.evaluate('scrollTo(0, 800)');
  await sleep(1000);
  r.check(
    'onScroll switched off: its hook sends nothing more',
    scrolls.length === count && strayEvents(h).length === 0,
    { more: scrolls.length - count, stray: strayEvents(h) }
  );
}

async function menu(h: Harness, r: Reporter, warnings: ReturnType<typeof captureWarnings>) {
  const chosen: CustomMenuSelectionEvent[] = [];
  await recreate(
    h,
    { extensions: [menuItems({ items: MENU, onSelect: (event) => chosen.push(event) })] },
    { remount: true }
  );
  const made = await webViewClass(h);
  r.check(
    "menuItems set at creation makes the WebView from the menu hook's class",
    typeof made === 'string' && made.includes(ios ? 'MenuWKWebView' : 'MenuWebView'),
    made
  );
  await loadHtml(h, ONE_WORD_OVER_THE_PAGE);
  r.drive({ action: 'longPress', point: '50%, 30%' });
  r.drive({ action: 'press', text: 'Highlight' });
  const selection = await poll(() => chosen[0], 30000);
  r.check(
    'a long press shows the item, and choosing it calls onSelect with the selected text',
    selection?.key === 'hl' && selection.label === 'Highlight' && selection.selectedText.length > 0,
    selection
  );
  await recreate(h, {}, { remount: true });
  h.setProps({ extensions: [menuItems({ items: MENU })] });
  await until(() => warnings.warned(`extension ${KEY}.menuItems`), 3000);
  r.check(
    'menuItems set after creation warns that its hook attaches only when the WebView is created',
    warnings.warned('attaches only when the WebView is created'),
    warnings.lines
  );
  h.setProps({});
}

async function background(h: Harness, r: Reporter) {
  if (!ios) {
    h.setProps({ extensions: [transparentBackground()] });
    await sleep(300);
    r.info(
      'transparentBackground',
      'WebView has no getter for its background color: check it by hand'
    );
    h.setProps({});
    return;
  }
  const opaque = async () => await h.ref.current?.call('webView.isOpaque').catch(errorCode);
  const states: unknown[] = [];
  for (const on of [true, false]) {
    h.setProps({ extensions: [on && transparentBackground()] });
    states.push((await poll(async () => (await opaque()) === !on, 3000)) ? !on : await opaque());
  }
  r.check(
    'transparentBackground, set after mount, makes the WebView not opaque; off, opaque again',
    JSON.stringify(states) === '[false,true]',
    states
  );
}

async function privacy(h: Harness, r: Reporter) {
  if (ios) {
    const persistent = async () =>
      await h.ref.current?.get('websiteDataStore.persistent').catch(errorCode);
    const before = await persistent();
    await recreate(h, { extensions: [incognito()] }, { remount: true });
    const after = await persistent();
    r.check(
      "incognito set at creation gives the WebView a data store that isn't saved",
      before === true && after === false,
      { before, after }
    );
    await recreate(h, {}, { remount: true });
    return;
  }
  const cookie = async () =>
    await h.ref.current?.call('cookieManager.getCookie', [h.pages]).catch(errorCode);
  await openPage(h, fresh(h, '/setcookie?name=incognito&value=1'));
  const set = await cookie();
  await openPage(h, fresh(h, '/'));
  const warnings = captureWarnings();
  h.setProps({ extensions: [incognito()] });
  await poll(() => warnings.warned(`extension ${KEY}.incognito`), 3000);
  warnings.stop();
  const kept = await cookie();
  r.check(
    'incognito set after creation warns that its hook attaches only when the WebView is created, and keeps the cookies',
    warnings.warned('attaches only when the WebView is created') &&
      String(kept).includes('incognito=1'),
    { lines: warnings.lines, kept }
  );
  await recreate(h, { extensions: [incognito()] }, { remount: true });
  const cleared = await cookie();
  const cacheMode = await h.ref.current?.get('settings.cacheMode').catch(errorCode);
  r.check(
    'incognito set at creation clears the cookies set before, and turns the cache off',
    String(set).includes('incognito=1') &&
      cleared === null &&
      cacheMode === AndroidConstants.WebSettings.LOAD_NO_CACHE,
    { set, cleared, cacheMode }
  );
  await recreate(h, {}, { remount: true });
}

async function keyboard(h: Harness, r: Reporter) {
  const focus = async () =>
    await h.ref.current
      ?.evaluate("(document.getElementById('i').focus(), document.activeElement.id)")
      .catch(errorCode);
  h.setProps({ extensions: [hideKeyboardAccessoryView()] });
  await loadHtml(h, '<input id="i">');
  const hidden = await focus();
  h.setProps({});
  await sleep(300);
  await loadHtml(h, '<input id="i">');
  const shown = await focus();
  r.check(
    'hideKeyboardAccessoryView on and then off: the page still focuses its input',
    hidden === 'i' && shown === 'i',
    { hidden, shown }
  );
  r.info(
    'hideKeyboardAccessoryView',
    'the bar shows only with the software keyboard: check it by hand'
  );
  // The keyboard shrinks the visual viewport. evaluate's script has a user gesture, which WebKit forwards to a timer but
  // not to a nested one: this focus is the page's own.
  const viewport = async () => (await h.ref.current?.evaluate('visualViewport.height')) as number;
  const keyboardShows = async () => {
    await loadHtml(h, '<input id="i">');
    const height = await viewport();
    await h.ref.current?.evaluate(
      "void setTimeout(() => setTimeout(() => document.getElementById('i').focus()))"
    );
    return !!(await poll(async () => (await viewport()) < height, 2000));
  };
  await recreate(h, {}, { remount: true });
  const before = await keyboardShows();
  h.setProps({ extensions: [keyboardDisplayRequiresUserAction(false)] });
  await sleep(300);
  const on = await keyboardShows();
  await recreate(h, { extensions: [keyboardDisplayRequiresUserAction(false)] }, { remount: true });
  h.setProps({});
  await sleep(300);
  const off = await keyboardShows();
  r.check(
    "keyboardDisplayRequiresUserAction(false), set after mount, lets a page script's focus() show the keyboard; off, not",
    !before && on && !off,
    { before, on, off }
  );
  const keyboardInset = async () => {
    await loadHtml(h, '<input id="i">');
    const height = await viewport();
    await touch(h, r, 'i');
    await poll(async () => (await viewport()) < height, 2000);
    await sleep(300);
    const inset = await h.ref.current?.get('scrollView.adjustedContentInset').catch(errorCode);
    return (inset as { bottom?: number } | undefined)?.bottom;
  };
  await recreate(h, {}, { remount: true });
  const observed = await keyboardInset();
  await recreate(h, {}, { remount: true });
  h.setProps({ extensions: [removeIosKeyboardObserver()] });
  await sleep(300);
  const removed = await keyboardInset();
  r.check(
    "removeIosKeyboardObserver, set after mount, keeps the keyboard out of the scroll view's inset",
    (observed ?? 0) > 0 && removed === 0,
    { observed, removed }
  );
  h.setProps({ extensions: [refreshControlLightMode()] });
  await sleep(300);
  r.info('refreshControlLightMode', 'the spinner shows only on a pull: check it by hand');
  h.setProps({});
}

async function android(h: Harness, r: Reporter) {
  const layer = async () => await h.ref.current?.call('webView.getLayerType').catch(errorCode);
  const types: unknown[] = [];
  for (const type of ['software', 'hardware', undefined] as const) {
    h.setProps({ extensions: [type && androidLayerType(type)] });
    const expected = { software: 1, hardware: 2, none: 0 }[type ?? 'none'];
    types.push(
      (await poll(async () => (await layer()) === expected, 3000)) ? expected : await layer()
    );
  }
  r.check(
    'androidLayerType, set after mount, sets the layer type live; off, none again',
    JSON.stringify(types) === '[1,2,0]',
    types
  );
  h.setProps({ extensions: [nestedScrollEnabled()] });
  await sleep(300);
  r.info(
    'nestedScrollEnabled',
    'needs a scrolling parent, which the example has none of: check it by hand'
  );
  const handed = () => h.events.downloads.length + h.events.downloadFailures.length;
  h.setProps({ extensions: [downloadManager({ downloadingMessage: 'Saving' })] });
  await openPage(h, fresh(h, '/media.html'));
  const before = handed();
  await h.ref.current?.evaluate(
    "(() => { const a = document.getElementById('attachment'); a.href = '/download?name=downloadManager.txt'; a.click(); })()"
  );
  await sleep(3000);
  const taken = handed() === before;
  await h.ref.current?.evaluate("document.getElementById('data').click()");
  const left = !!(await poll(() => handed() > before, 10000));
  r.check(
    'downloadManager takes an attachment from onDownload, and leaves it a data: download',
    taken && left,
    { taken, left, downloads: h.events.downloads.slice(-1), failures: h.events.downloadFailures }
  );
  r.info(
    'downloadManager',
    'the file in the Downloads folder, its notification and the toast: check them by hand'
  );
  const failed: SubResourceErrorEvent[] = [];
  h.setProps({ extensions: [onLoadSubResourceError((event) => failed.push(event))] });
  await sleep(300);
  const unreachableImage = 'http://127.0.0.1:1/x.png';
  await loadHtml(
    h,
    `<img src="${unreachableImage}"><img src="${HTTPS}/x.png" onerror="window.sslFailed = true">`
  );
  const reported = await poll(() => failed.find(({ url }) => url === unreachableImage), 5000);
  const sslFailed = await poll(
    async () =>
      (await h.ref.current?.evaluate('window.sslFailed === true').catch(errorCode)) === true,
    5000
  );
  await openPage(h, 'http://127.0.0.1:1/main');
  await sleep(1000);
  r.check(
    "onLoadSubResourceError, set after mount, gets an image's failure with its code; not an SSL one or the main frame's",
    !!reported &&
      reported.code < 0 &&
      sslFailed === true &&
      !failed.some(({ url }) => url.startsWith('https:') || url.endsWith('/main')),
    { failed, sslFailed }
  );
  h.setProps({});
}
