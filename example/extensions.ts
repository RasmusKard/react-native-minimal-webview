// The extensions suite: @react-native-minimal-webview/extensions' functions, through the WebView's `extensions` prop.
import {
  type CustomMenuSelectionEvent,
  type Dialog,
  type ScrollEvent,
  androidLayerType,
  basicAuthCredential,
  dialogs as dialogsExtension,
  downloadManager,
  hideKeyboardAccessoryView,
  incognito,
  keyboardDisplayRequiresUserAction,
  menuItems,
  nestedScrollEnabled,
  onScroll,
  refreshControlLightMode,
  transparentBackground,
} from '@react-native-minimal-webview/extensions';
import { Platform } from 'react-native';
import { AndroidConstants, IOSConstants } from 'react-native-minimal-webview';
import { sampleHook } from 'sample-extension';

import {
  type Harness,
  captureWarnings,
  errorCode,
  fresh,
  openPage,
  pageLog,
  recreate,
  reporter,
  sleep,
  text,
  until,
} from './harness';

type Reporter = ReturnType<typeof reporter>;

const KEY = '@react-native-minimal-webview/extensions';
const ios = Platform.OS === 'ios';
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const MENU = [{ label: 'Highlight', key: 'hl' }];

/** Loads `body` as an html source and waits until it is the page. */
async function loadHtml(h: Harness, body: string) {
  const title = `ext-${Date.now()}`;
  h.loadSource({
    html: `<!doctype html>${VIEWPORT}<title>${title}</title>${body}`,
    baseUrl: h.pages,
  });
  return !!(await until(
    async () => (await h.ref.current?.evaluate('document.title')) === title,
    10000
  ));
}

/** The WebView's class, from its `description` (iOS) or `toString()` (Android). */
const webViewClass = async (h: Harness) =>
  await h.ref.current?.call(ios ? 'webView.description' : 'webView.toString').catch(errorCode);

/** Events of this package's hooks that no extension took: App logs those, and those of an extension without `onEvent`. */
const strayEvents = (h: Harness) => h.events.hookEvents.filter((name) => name.startsWith(KEY));

/**
 * Each extension's effect, and that a WebView with none of them gets none of the package's hooks. The menu needs the
 * driver's long press (maestro/extensions.yaml). Left to a person: what shows only on screen (the keyboard accessory
 * bar, the refresh spinner's color, Android's transparent background, the Download Manager's file and toast) and
 * nested scrolling.
 */
export async function extensions(h: Harness) {
  const r = reporter('extensions');
  const warnings = captureWarnings();
  try {
    await inert(h, r);
    await auth(h, r);
    await dialogs(h, r, warnings);
    await scroll(h, r);
    await menu(h, r, warnings);
    await background(h, r);
    await privacy(h, r);
    await (ios ? keyboard(h, r) : android(h, r));
    const stray = warnings.lines.filter(
      (line) => line.includes(`hookOptions.${KEY}.`) && !line.includes(`${KEY}.menuItems`)
    );
    r.check(
      'no extension key warns: each is registered, and sent only on its platforms',
      stray.length === 0,
      stray
    );
  } finally {
    warnings.stop();
  }
  r.done();
}

// Browsers reuse an origin's credentials for any realm, and other suites sign in on localhost: the declines use an origin
// nobody signs in on, and the sign-in one of its own (the emulator's host alias, the simulator's IPv6 loopback).
const DECLINED = 'http://127.0.0.1:8090';
const SIGNED_IN = ios ? 'http://[::1]:8090' : 'http://10.0.2.2:8090';

async function inert(h: Harness, r: Reporter) {
  await recreate(h, {}, true);
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
  await openPage(h, fresh(h, `${DECLINED}/auth?t=ext-wrong`));
  const wrong = await text(h, 'auth');
  r.check(
    'basicAuthCredential with a rejected credential stops: the 401 page shows',
    wrong === 'unauthorized',
    wrong
  );
  h.setProps({});
  await sleep(300);
  if (!ios) return;
  // Its delegate comes first (its package registers first) and passes on the challenge after its credential fails:
  // the later hook's delegate is asked only then.
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
    const lines = await pageLog(h, () => {
      // Not awaited: on iOS evaluate doesn't return while a dialog blocks the page.
      void h.ref.current?.evaluate(`setTimeout(() => document.getElementById('${id}').click(), 0)`);
    });
    r.check(
      `onDialog answers the ${id}, and the page gets the answer`,
      lines?.join() === expected,
      lines
    );
  }
  const got = seen.map(({ type, message, defaultValue }) => [type, message, defaultValue]);
  r.check(
    "onDialog gets each dialog's type, message and default text",
    JSON.stringify(got) ===
      JSON.stringify([
        ['alert', 'hello', null],
        ['confirm', 'ok?', null],
        ['prompt', 'name?', 'default'],
      ]),
    seen
  );
  // Android checks when the callback comes, iOS when the delegates are set.
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
  const scrolls: ScrollEvent['nativeEvent'][] = [];
  // react-native-webview's default, so the offsets have no inset in them.
  const insets = {
    scrollView: {
      contentInsetAdjustmentBehavior: IOSConstants.ContentInsetAdjustmentBehavior.never,
    },
  };
  h.setProps({
    ios: insets,
    extensions: [onScroll(({ nativeEvent }) => scrolls.push(nativeEvent))],
  });
  await loadHtml(h, '<div style="height: 5000px">tall</div>');
  await h.ref.current?.evaluate('scrollTo(0, 400)');
  const at = await until(
    () => scrolls.find(({ contentOffset }) => Math.abs(contentOffset.y - 400) < 1),
    3000
  );
  r.check(
    'onScroll, set after mount, gets the offset, and a content size taller than the view',
    !!at && at.contentSize.height > at.layoutMeasurement.height,
    scrolls.at(-1)
  );
  h.setProps({ ios: insets });
  await sleep(300);
  const count = scrolls.length;
  // A hook switched off earlier in the suite (a dialog's answer) may still send one: only what the scroll sends counts.
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
  const chosen: CustomMenuSelectionEvent['nativeEvent'][] = [];
  await recreate(
    h,
    {
      extensions: [
        menuItems({ items: MENU, onSelect: ({ nativeEvent }) => chosen.push(nativeEvent) }),
      ],
    },
    true
  );
  const made = await webViewClass(h);
  r.check(
    "menuItems set at creation makes the WebView from the menu hook's class",
    typeof made === 'string' && made.includes(ios ? 'MenuWKWebView' : 'MenuWebView'),
    made
  );
  // One long word over the whole page: the driver's long press lands on text wherever it is.
  await loadHtml(
    h,
    `<p style="font: 48px/1.2 system-ui; word-break: break-all; margin: 0">${'a'.repeat(3000)}</p>`
  );
  r.info('LONGPRESS', 'then Highlight');
  const selection = await until(() => chosen[0], 30000);
  r.check(
    'a long press shows the item, and choosing it calls onSelect with the selected text',
    selection?.key === 'hl' && selection.label === 'Highlight' && selection.selectedText.length > 0,
    selection
  );
  await recreate(h, {}, true);
  h.setProps({ extensions: [menuItems({ items: MENU })] });
  await until(() => warnings.warned(`hookOptions.${KEY}.menuItems`), 3000);
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
    states.push((await until(async () => (await opaque()) === !on, 3000)) ? !on : await opaque());
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
    await recreate(h, { extensions: [incognito()] }, true);
    const after = await persistent();
    r.check(
      "incognito set at creation gives the WebView a data store that isn't saved",
      before === true && after === false,
      { before, after }
    );
    await recreate(h, {}, true);
    return;
  }
  const cookie = async () =>
    await h.ref.current?.call('cookieManager.getCookie', [h.pages]).catch(errorCode);
  await openPage(h, fresh(h, '/setcookie?name=incognito&value=1'));
  const set = await cookie();
  await openPage(h, fresh(h, '/')); // the source the new WebView loads
  await recreate(h, { extensions: [incognito()] }, true);
  const cleared = await cookie();
  const cacheMode = await h.ref.current?.get('settings.cacheMode').catch(errorCode);
  r.check(
    'incognito set at creation clears the cookies set before, and turns the cache off',
    String(set).includes('incognito=1') &&
      cleared === null &&
      cacheMode === AndroidConstants.WebSettings.LOAD_NO_CACHE,
    { set, cleared, cacheMode }
  );
  await recreate(h, {}, true);
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
    return !!(await until(async () => (await viewport()) < height, 2000));
  };
  // Each WebView is one the keyboard hasn't shown for: WebKit's own rules show it for a later focus in that one.
  await recreate(h, {}, true);
  const before = await keyboardShows();
  h.setProps({ extensions: [keyboardDisplayRequiresUserAction(false)] });
  await sleep(300);
  const on = await keyboardShows();
  await recreate(h, { extensions: [keyboardDisplayRequiresUserAction(false)] }, true);
  h.setProps({});
  await sleep(300);
  const off = await keyboardShows();
  r.check(
    "keyboardDisplayRequiresUserAction(false), set after mount, lets a page script's focus() show the keyboard; off, not",
    !before && on && !off,
    { before, on, off }
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
      (await until(async () => (await layer()) === expected, 3000)) ? expected : await layer()
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
  // The Download Manager can't fetch a data: URL: onDownload still gets that one.
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
  const left = !!(await until(() => handed() > before, 10000));
  r.check(
    'downloadManager takes an attachment from onDownload, and leaves it a data: download',
    taken && left,
    { taken, left, downloads: h.events.downloads.slice(-1), failures: h.events.downloadFailures }
  );
  r.info(
    'downloadManager',
    'the file in the Downloads folder, its notification and the toast: check them by hand'
  );
  h.setProps({});
}
