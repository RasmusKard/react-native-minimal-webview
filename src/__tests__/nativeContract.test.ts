// The names JS and native agree on, read from the sources: a prop, event, function or page request renamed or added on
// one side fails here by name. The on-device suites would only show it as a feature that stopped working.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AskableEvent, BridgeEvent, NativeErrorEvent } from '../WebView';
import type {
  Download,
  DownloadFailure,
  FileRequest,
  FullscreenChangeEvent,
  HookEvent,
  NavigationEvent,
  NavigationRequest,
  NavigationState,
  PermissionRequest,
  ProcessGoneEvent,
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

const PROP = /\bProp\("(\w+)"\)/g;
const FUNCTION = /\b(?:AsyncFunction|Function|Constant)\("(\w+)"\)/g;
const events = (text: string) => names(text.match(/\bEvents\(([^)]*)\)/)?.[1] ?? '', /"(\w+)"/g);

const IOS_ONLY_PROPS = ['sharedCookies'];
const ANDROID_ONLY_FUNCTIONS = ['defaultUserAgent', 'preconnect', 'warmUp'];

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

test('the page requests JS routes are the ones native asks for or gates on', () => {
  const requests = names(ts.match(/const REQUESTS = \{([^}]*)\}/)?.[1] ?? '', /^\s*(\w+):/gm);
  const told = ['warning', 'askCancelled'];
  const asked = names(natives, /"core\.(\w+)"/g).filter((name) => !told.includes(name));
  const gated = names(
    natives,
    /"(\w+)" !?in owner\.requestHandlers|requestHandlers\.contains\("(\w+)"\)/g
  );
  expect([...new Set([...asked, ...gated])].sort()).toEqual(requests);
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
const PAYLOADS: Record<'android' | 'ios', Row[]> = {
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
    const text = read(platform === 'android' ? `${ANDROID}/${row.file}` : `ios/${row.file}`);
    const found = [...text.matchAll(row.emitSite)].map((m) =>
      names(literal(text, m.index + m[0].length), KEY[platform]).join()
    );
    const expected = [row.keys].flat().map((keys) => Object.keys(keys).sort().join());
    expect([...new Set(found)].sort()).toEqual(expected.sort());
  });

  test('the table covers every native event and every core event the platform emits', () => {
    const sources = nativeFiles.filter((file) => file.startsWith('ios/') === (platform === 'ios'));
    const emitted = names(sources.map(read).join('\n'), /"(core\.\w+)"/g);
    const listed = new Set(rows.map((row) => row.event));
    expect([...listed].filter((event) => event.startsWith('core.')).sort()).toEqual([
      ...new Set(emitted),
    ]);
    expect(
      events(platform === 'ios' ? swift : kotlin).filter((event) => !listed.has(event))
    ).toEqual([]);
  });
});
