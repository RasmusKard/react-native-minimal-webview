// The names JS and native agree on, read from the sources: a prop, event, function or page request renamed or added on
// one side fails here by name. The on-device suites would only show it as a feature that stopped working.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const names = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].map((m) => m[1] ?? m[2] ?? '').sort();

const ANDROID = 'android/src/main/java/expo/modules/minimalwebview';
const kotlin = read(`${ANDROID}/MinimalWebViewModule.kt`);
const swift = read('ios/MinimalWebViewModule.swift');
const ts = read('src/WebView.tsx');
const natives = [ANDROID, `${ANDROID}/requests`, 'ios']
  .flatMap((dir) => readdirSync(join(root, dir)).map((file) => `${dir}/${file}`))
  .filter((file) => /\.(kt|swift)$/.test(file))
  .map(read)
  .join('\n');

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
  const asked = names(natives, /"core\.(\w+)"/g).filter((name) => name !== 'warning');
  const gated = names(
    natives,
    /"(\w+)" !?in owner\.requestHandlers|requestHandlers\.contains\("(\w+)"\)/g
  );
  expect([...new Set([...asked, ...gated])].sort()).toEqual(requests);
  expect(ts).toContain('`${CORE}warning`');
});
