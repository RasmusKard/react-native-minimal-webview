// The names and values JS and native agree on, read from the sources: a prop, event, function, page request, payload
// key or value renamed or added on one side fails here by name. The on-device suites would only show it as a feature
// that stopped working.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AskableEvent, BridgeEvent, NativeErrorEvent, NativeMethods } from '../WebView';
import type {
  AndroidSettings,
  Download,
  DownloadFailure,
  FileRequest,
  FullscreenChangeEvent,
  HookEvent,
  InjectedScript,
  IOSSettings,
  LoadErrorEvent,
  NavigationEvent,
  NavigationRequest,
  NavigationRule,
  NavigationState,
  PermissionRequest,
  PermissionResource,
  ProcessGoneEvent,
  WebViewErrorCode,
  WebViewSource,
} from '../types';

const root = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const names = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].map((m) => m[1] ?? m[2] ?? '').sort();

const ANDROID = 'android/src/main/java/expo/modules/minimalwebview';
const kotlin = read(`${ANDROID}/MinimalWebViewModule.kt`);
const swift = read('ios/MinimalWebViewModule.swift');
const ts = read('src/WebView.tsx');
const nativeFiles = [ANDROID, `${ANDROID}/requests`, 'ios']
  .flatMap((dir) => readdirSync(join(root, dir)).map((file) => `${dir}/${file}`))
  .filter((file) => /\.(kt|swift)$/.test(file));
const natives = nativeFiles.map(read).join('\n');
type Platform = 'android' | 'ios';
const DIR: Record<Platform, string> = { android: ANDROID, ios: 'ios' };
const sources = (platform: Platform) =>
  nativeFiles.filter((file) => file.startsWith('ios/') === (platform === 'ios'));

const PROP = /\bProp\("(\w+)"\)/g;
const FUNCTION = /\b(?:AsyncFunction|Function|Constant)\("(\w+)"\)/g;
const events = (text: string) => names(text.match(/\bEvents\(([^)]*)\)/)?.[1] ?? '', /"(\w+)"/g);

const IOS_ONLY_PROPS = ['sharedCookies'];
const ANDROID_ONLY_FUNCTIONS = ['defaultUserAgent', 'preconnect', 'warmUp'];
const ANDROID_ONLY_REQUESTS = ['fileRequest', 'fullscreenChange'];

test('both platforms define the same props, events and functions, except the documented platform-only ones', () => {
  expect(names(swift, PROP)).toEqual([...names(kotlin, PROP), ...IOS_ONLY_PROPS].sort());
  expect(events(swift)).toEqual(events(kotlin));
  expect([...names(swift, FUNCTION), ...ANDROID_ONLY_FUNCTIONS].sort()).toEqual(
    names(kotlin, FUNCTION)
  );
});

test('the native view gets exactly the native props and events, and JS calls exactly the native functions', () => {
  const jsx = ts.match(/<NativeWebView\b([^]*?)\/>/)?.[1] ?? '';
  const attributes = names(jsx, /^\s*(\w+)=/gm).filter((name) => !['key', 'ref'].includes(name));
  expect(attributes).toEqual([...names(swift, PROP), ...events(swift)].sort());
  const calls = names(ts, /native\.current\?\.(\w+)\(|nativeModule\(\)\.(\w+)/g);
  expect([...new Set(calls)]).toEqual(names(kotlin, FUNCTION));
});

test('the page requests JS routes are the ones native asks for, and each platform gates the ones it has', () => {
  const requests = names(ts.match(/const REQUESTS = \{([^}]*)\}/)?.[1] ?? '', /^\s*(\w+):/gm);
  const told = ['warning', 'askCancelled'];
  const asked = names(natives, /"core\.(\w+)"/g).filter((name) => !told.includes(name));
  const gated = (platform: Platform, gate: RegExp) =>
    names(sources(platform).map(read).join('\n'), gate);
  expect(asked.filter((name) => !requests.includes(name))).toEqual([]);
  expect(gated('android', /"(\w+)" !?in owner\.requestHandlers/g)).toEqual(requests);
  expect(
    [...gated('ios', /requestHandlers\.contains\("(\w+)"\)/g), ...ANDROID_ONLY_REQUESTS].sort()
  ).toEqual(requests);
  told.forEach((name) => expect(ts).toContain(`\`\${CORE}${name}\``));
});

// Payload keys: each type's keys as a `Record`, so a key added to the type and not here fails to compile.
type Keys = Record<string, unknown>;
const state = {
  url: 1,
  pendingUrl: 1,
  title: 1,
  loading: 1,
  progress: 1,
  canGoBack: 1,
  canGoForward: 1,
  outcome: 1,
} satisfies Record<keyof NavigationState, 1>;
const request = { url: 1, mainFrame: 1, newWindow: 1, userInitiated: 1 } satisfies Record<
  keyof NavigationRequest,
  1
>;
const navigation = { ...request, action: 1, rule: 1 } satisfies Record<keyof NavigationEvent, 1>;
const error = { kind: 1, url: 1, code: 1, description: 1 } satisfies Record<
  keyof NativeErrorEvent,
  1
>;
const processGone = { didCrash: 1, recovered: 1 } satisfies Record<keyof ProcessGoneEvent, 1>;
const message = { message: 1, origin: 1 } satisfies Record<
  keyof Extract<BridgeEvent, { message: string }>,
  1
>;
const navigated = { navigated: 1 } satisfies Record<
  keyof Extract<BridgeEvent, { navigated: true }>,
  1
>;
const unavailable = { unavailable: 1 } satisfies Record<
  keyof Extract<BridgeEvent, { unavailable: true }>,
  1
>;
const hookEvent = { name: 1, payload: 1 } satisfies Record<keyof HookEvent, 1>;
const askable = { ...hookEvent, askId: 1 } satisfies Record<keyof AskableEvent, 1>;
const download = { ok: 1, uri: 1, filename: 1, mimeType: 1, url: 1 } satisfies Record<
  keyof Download,
  1
>;
const failure = { ok: 1, filename: 1, url: 1, reason: 1 } satisfies Record<
  keyof DownloadFailure,
  1
>;
const permission = { origin: 1, resources: 1 } satisfies Record<keyof PermissionRequest, 1>;
const file = { accept: 1, multiple: 1, capture: 1 } satisfies Record<keyof FileRequest, 1>;
const fullscreen = { active: 1 } satisfies Record<keyof FullscreenChangeEvent, 1>;
// No type: JS reads `payload['message']` and `payload['askId']` untyped.
const warning = { message: 1 };
const askCancelled = { askId: 1 };
// onNavigation's payload is the navigation request's (its own row) plus these, added at the emit site.
const decision = Object.fromEntries(
  Object.keys(navigation)
    .filter((key) => !(key in request))
    .map((key) => [key, 1])
);

type Row = { event: string; file: string; emitSite: RegExp; keys: Keys | Keys[] };
// Every literal after each `emitSite` match must have one of `keys`' key sets, and each set must occur.
const PAYLOADS: Record<Platform, Row[]> = {
  android: [
    {
      event: 'onNavigationState',
      file: 'MinimalWebView.kt',
      emitSite: /val state = mapOf/g,
      keys: state,
    },
    {
      event: 'onNavigation',
      file: 'MinimalWebViewNavigation.kt',
      emitSite: /fields\(request\) \+ mapOf/g,
      keys: decision,
    },
    { event: 'onError', file: 'MinimalWebView.kt', emitSite: /onError\(/g, keys: error },
    {
      event: 'onProcessGone',
      file: 'MinimalWebView.kt',
      emitSite: /onProcessGone\(/g,
      keys: processGone,
    },
    {
      event: 'onBridge',
      file: 'MinimalWebViewScripts.kt',
      emitSite: /onBridge\(/g,
      keys: [message, navigated, unavailable],
    },
    // Not `Asks { onHookEvent(it) }`: its literals are in Asks.kt.
    {
      event: 'onHookEvent',
      file: 'MinimalWebView.kt',
      emitSite: /onHookEvent\(mapOf/g,
      keys: hookEvent,
    },
    { event: 'onHookEvent', file: 'Asks.kt', emitSite: /send\(/g, keys: [hookEvent, askable] },
    {
      event: 'core.navigationRequest',
      file: 'MinimalWebViewNavigation.kt',
      emitSite: /fun fields\(/g,
      keys: request,
    },
    {
      event: 'core.download',
      file: 'requests/Downloads.kt',
      emitSite: /"core\.download",/g,
      keys: [download, failure],
    },
    {
      event: 'core.permissionRequest',
      file: 'requests/Permissions.kt',
      emitSite: /"core\.permissionRequest",/g,
      keys: permission,
    },
    {
      event: 'core.fileRequest',
      file: 'requests/FileUpload.kt',
      emitSite: /val request = mapOf/g,
      keys: file,
    },
    {
      event: 'core.fullscreenChange',
      file: 'requests/FullscreenVideo.kt',
      emitSite: /"core\.fullscreenChange",/g,
      keys: fullscreen,
    },
    {
      event: 'core.warning',
      file: 'MinimalWebView.kt',
      emitSite: /"core\.warning",/g,
      keys: warning,
    },
    {
      event: 'core.askCancelled',
      file: 'Asks.kt',
      emitSite: /"core\.askCancelled",/g,
      keys: askCancelled,
    },
  ],
  ios: [
    {
      event: 'onNavigationState',
      file: 'MinimalWebView.swift',
      emitSite: /let state: NSDictionary =/g,
      keys: state,
    },
    {
      event: 'onNavigation',
      file: 'MinimalWebView+Navigation.swift',
      emitSite: /request\.payload\.merging\(/g,
      keys: decision,
    },
    { event: 'onError', file: 'MinimalWebView.swift', emitSite: /onError\(/g, keys: error },
    {
      event: 'onProcessGone',
      file: 'MinimalWebView.swift',
      emitSite: /onProcessGone\(/g,
      keys: processGone,
    },
    // No `unavailable`: WebKit always has what the bridge needs.
    {
      event: 'onBridge',
      file: 'MinimalWebView+Scripts.swift',
      emitSite: /onBridge\(/g,
      keys: message,
    },
    { event: 'onBridge', file: 'MinimalWebView.swift', emitSite: /onBridge\(/g, keys: navigated },
    // Not `Asks { [weak self] in self?.onHookEvent($0) }`: its literals are in Asks.swift.
    {
      event: 'onHookEvent',
      file: 'MinimalWebView.swift',
      emitSite: /onHookEvent\((?=\[)/g,
      keys: hookEvent,
    },
    { event: 'onHookEvent', file: 'Asks.swift', emitSite: /send\(/g, keys: [hookEvent, askable] },
    {
      event: 'core.navigationRequest',
      file: 'NavigationRules.swift',
      emitSite: /var payload: \[String: Any\] \{/g,
      keys: request,
    },
    {
      event: 'core.download',
      file: 'Downloads.swift',
      emitSite: /"core\.download",/g,
      keys: [download, failure],
    },
    {
      event: 'core.permissionRequest',
      file: 'MinimalWebView+Dialogs.swift',
      emitSite: /"core\.permissionRequest",/g,
      keys: permission,
    },
    {
      event: 'core.warning',
      file: 'MinimalWebView.swift',
      emitSite: /"core\.warning",/g,
      keys: warning,
    },
    {
      event: 'core.askCancelled',
      file: 'Asks.swift',
      emitSite: /"core\.askCancelled", "payload":/g,
      keys: askCancelled,
    },
  ],
};
const KEY = { android: /"(\w+)" to/g, ios: /"(\w+)":/g };

/** The top level of the first `(…)` or `[…]` from `from` on: a nested literal's keys are not this one's. */
const literal = (text: string, from: number) => {
  let depth = 0;
  let top = '';
  for (const char of text.slice(from + text.slice(from).search(/[([]/))) {
    if ('(['.includes(char)) depth++;
    if (depth === 1) top += char;
    if (')]'.includes(char) && --depth === 0) break;
  }
  return top;
};

describe.each(['android', 'ios'] as const)('%s payloads', (platform) => {
  const rows = PAYLOADS[platform];
  test.each(rows.map((row) => [row.event, row.file, row] as const))('%s in %s', (_, __, row) => {
    const text = read(`${DIR[platform]}/${row.file}`);
    const found = [...text.matchAll(row.emitSite)].map((m) =>
      names(literal(text, m.index + m[0].length), KEY[platform]).join()
    );
    const expected = [row.keys].flat().map((keys) => Object.keys(keys).sort().join());
    expect([...new Set(found)].sort()).toEqual(expected.sort());
  });

  test('the table covers every native event and every core event the platform emits', () => {
    const emitted = names(sources(platform).map(read).join('\n'), /"(core\.\w+)"/g);
    const listed = new Set(rows.map((row) => row.event));
    expect([...listed].filter((event) => event.startsWith('core.')).sort()).toEqual([
      ...new Set(emitted),
    ]);
    expect(
      events(platform === 'ios' ? swift : kotlin).filter((event) => !listed.has(event))
    ).toEqual([]);
  });
});

// Values: each TS union as a `Record`, so a member added to the type and not here fails to compile.
/** Every key of a union's members (`keyof` a union is only the keys they share). */
type AllKeys<T> = T extends unknown ? keyof T : never;
const outcome = { finished: 1, failed: 1, cancelled: 1 } satisfies Record<
  NonNullable<NavigationState['outcome']>,
  1
>;
const kind = { network: 1, ssl: 1, http: 1 } satisfies Record<LoadErrorEvent['kind'], 1>;
const source = { uri: 1, headers: 1, body: 1, html: 1, baseUrl: 1 } satisfies Record<
  AllKeys<WebViewSource>,
  1
>;
const script = { code: 1, mainFrameOnly: 1 } satisfies Record<keyof InjectedScript, 1>;
const iosRoots = {
  configuration: 1,
  preferences: 1,
  webpagePreferences: 1,
  webView: 1,
  scrollView: 1,
} satisfies Record<keyof IOSSettings, 1>;
const androidRoots = { settings: 1, webView: 1 } satisfies Record<keyof AndroidSettings, 1>;
const verbs = { back: 1, forward: 1, reload: 1, stop: 1 } satisfies Record<
  Parameters<NativeMethods['navigate']>[0],
  1
>;
const resources = { camera: 1, microphone: 1, geolocation: 1, protectedMedia: 1 } satisfies Record<
  PermissionResource,
  1
>;
const actions = { allow: 1, block: 1, external: 1, ask: 1 } satisfies Record<
  NavigationRule['action'],
  1
>;
const codes = {
  script_error: 1,
  native_error: 1,
  navigated: 1,
  unavailable: 1,
  hook_not_handled: 1,
} satisfies Record<WebViewErrorCode, 1>;

type ValueRow = {
  name: string;
  keys: Keys;
  /** The platform's sources `site` is in; every one when unset. */
  files?: string[];
  site: RegExp;
  /** Default: the quoted words. */
  value?: RegExp;
  /** The documented values this platform doesn't have. */
  lacks?: string[];
};
// The `value` matches inside every `site` match must be exactly `keys`, bar what the platform `lacks`.
const FIELD = /@Field (?:val|var) (\w+)/g;
const CODE = /(?:reject\(|failure\(|EvaluateError\((?:code: )?)"\w+"/g;
const VALUES: Record<Platform, ValueRow[]> = {
  android: [
    {
      name: 'outcome',
      keys: outcome,
      files: ['MinimalWebView.kt', 'MinimalWebViewClients.kt'],
      site: /outcome = [^\n/]*|-> "\w+"/g,
    },
    { name: 'error kind', keys: kind, site: /reportError\("\w+"/g },
    {
      name: 'WebViewSource fields',
      keys: source,
      site: /class WebViewSource\([^]*?\) : Record/g,
      value: FIELD,
    },
    {
      name: 'InjectedScript fields',
      keys: script,
      site: /class InjectedScript\([^]*?\) : Record/g,
      value: FIELD,
    },
    { name: 'settings roots', keys: androidRoots, site: /rootName in listOf\([^)]*\)/g },
    {
      name: 'get and call roots',
      keys: { ...androidRoots, cookieManager: 1, webStorage: 1 },
      files: ['PlatformSettings.kt'],
      site: /"\w+" -> listOf/g,
    },
    { name: 'navigate verbs', keys: verbs, site: /"\w+" -> view\./g },
    {
      name: 'permission resources',
      keys: resources,
      files: ['requests/Permissions.kt'],
      site: / to "\w+"|listOf\("\w+"\)/g,
    },
    { name: 'rule actions', keys: actions, site: /val actions = setOf\([^)]*\)/g },
    { name: 'error codes', keys: codes, site: CODE },
  ],
  ios: [
    { name: 'outcome', keys: outcome, site: /outcome = [^\n/]*/g },
    { name: 'error kind', keys: kind, site: /(?<="kind": )[^,]*/g },
    {
      name: 'WebViewSource fields',
      keys: source,
      site: /struct WebViewSource: Record \{[^}]*/g,
      value: FIELD,
    },
    {
      name: 'InjectedScript fields',
      keys: script,
      site: /struct InjectedScript: Record \{[^}]*/g,
      value: FIELD,
    },
    // Every root: the `ios` prop's, and `websiteDataStore` and `httpCookieStore` for `get` and `call`.
    {
      name: 'settings roots',
      keys: { ...iosRoots, websiteDataStore: 1, httpCookieStore: 1 },
      site: /func root\([^]*?default:/g,
    },
    { name: 'navigate verbs', keys: verbs, site: /case "\w+": view\./g },
    {
      name: 'permission resources',
      keys: resources,
      site: /let resources: \[String\] = switch type \{[^}]*/g,
      lacks: ['geolocation', 'protectedMedia'],
    },
    { name: 'rule actions', keys: actions, site: /let actions: Set<String> = \[[^\]]*\]/g },
    { name: 'error codes', keys: codes, site: CODE },
  ],
};

describe.each(['android', 'ios'] as const)('%s values', (platform) => {
  test.each(VALUES[platform].map((row) => [row.name, row] as const))('%s', (_, row) => {
    const files = row.files?.map((file) => `${DIR[platform]}/${file}`) ?? sources(platform);
    const sites = files.map(read).join('\n').match(row.site) ?? [];
    const found = new Set(names(sites.join('\n'), row.value ?? /"(\w+)"/g));
    expect([...found, ...(row.lacks ?? [])].sort()).toEqual(Object.keys(row.keys).sort());
  });
});

test('the navigation vectors the native matchers run use every NavigationRule key', () => {
  const vectors = JSON.parse(read('src/__tests__/vectors/navigation-rules.json')) as {
    rulesets: Record<string, Record<string, unknown>[]>;
  };
  const used = new Set(Object.values(vectors.rulesets).flat().flatMap(Object.keys));
  const ruleKeys = {
    scheme: 1,
    host: 1,
    path: 1,
    query: 1,
    mainFrame: 1,
    newWindow: 1,
    userInitiated: 1,
    action: 1,
  } satisfies Record<keyof NavigationRule, 1>;
  expect([...used].sort()).toEqual(Object.keys(ruleKeys).sort());
});

test('the bridge transport has the names the page client uses', () => {
  const page = read('src/bridge/pageClient.ts');
  const scripts = read('ios/MinimalWebView+Scripts.swift');
  const [transport] = names(
    read(`${ANDROID}/MinimalWebViewScripts.kt`),
    /addWebMessageListener\(webView, "(\w+)"/g
  );
  const [handler] = names(
    read('ios/MinimalWebView.swift'),
    /contentWorld: \.page, name: "(\w+)"\)/g
  );
  const [, global, receive] = scripts.match(/window\.(\w+)\?\.(\w+)\(message\)/) ?? [];
  expect(page).toContain(`const android = w.${transport};`);
  expect(page).toContain(`const ios = w.webkit?.messageHandlers?.${handler};`);
  expect(page).toContain(`w.${global} = Object.freeze({`);
  expect(page).toContain(`${receive}: receive,`);
});

// What only one platform's hooks get: Android's clients, iOS's delegates.
const ANDROID_ONLY_CONTEXT = ['chromeClients', 'clients'];
const IOS_ONLY_CONTEXT = ['navigationDelegates', 'uiDelegates'];

test("a hook's WebViewContext has the same members on both platforms, bar the platform-only ones", () => {
  const members = (path: string, start: RegExp) => {
    const text = read(path);
    const body = text.slice(text.search(start)).split(/\n\}/)[0] ?? '';
    return names(body, /^\s+(?:val|var|fun|func) (\w+)/gm);
  };
  const android = members(`${ANDROID}/Hooks.kt`, /^interface WebViewContext \{/m);
  const ios = members('ios/Hooks.swift', /^public protocol WebViewContext\b/m);
  expect([...android, ...IOS_ONLY_CONTEXT].sort()).toEqual(
    [...ios, ...ANDROID_ONLY_CONTEXT].sort()
  );
});
