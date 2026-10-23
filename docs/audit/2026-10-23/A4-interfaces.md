# A4: interface inventory and drift (audit-2026-10-23 @ 333f05f)

## (a) Summary

1. Four surfaces inventoried below. The names are clean: of 560 distinct backticked identifiers in 13 docs, the 117 not in the sources are platform APIs, shell commands, react-native-webview props or props this package lacks on purpose, and none is a renamed or removed name of this package; every relative link and anchor resolves; the error-code sets, the 1 s ask timeout and the 3-in-60 s crash guard are equal in docs and on both platforms, and the 5 s new-window drop and the 100 MB cap match the Android code.
2. The drift is in behaviour claims and one doc gap, not names: 2 wrong claims (A4-01 crash-guard reset, A4-02 `ref.hook` while Android rebuilds), 1 contradiction between user docs and `decisions.md` (A4-03), 3 context members no doc names (A4-04), 9 smaller items.
3. The hooks API is the same on 7 of 9 (Swift) / 10 (Kotlin) context members; of the other differences 7 follow the platforms and 2 are accidental (detach reason, thread safety of `emit`/`ask`). A 40-line test (below) catches the member, error-code and constant classes; it cannot catch A4-01/02.

## Inventory

**TS** (`src/index.ts`): values `WebView` (statics `defaultUserAgent`, `warmUp`, `preconnect`: Android only), `createWebViewRef`, `useWebViewState`, `createBridge`, `WK`, `Android`; types: the 31 of `types.ts` + `BridgeErrorCode`.
Props (23 own + `ref` + `ViewProps` minus `children`). Content: `source`, `injectedScripts`, `bridge`, `ios`, `android`, `userAgent`, `pullToRefresh`, `sharedCookies` (iOS). Rules: `navigationRules`, `onNavigationRequest` (ask), `onOpenExternal(url)`, `onNavigation`. State: `onNavigationStateChange`, `onLoadStart`, `onLoadEnd`, `onError`, `onProcessGone`. Page requests: `onFileRequest` (ask, Android), `onPermissionRequest` (ask), `onFullscreenChange` (Android), `onDownload`. Hooks: `hookOptions`, `onHookEvent` (ask and notification).
Ref (8): `goBack goForward reload stopLoading` (void), `evaluate get call hook` (`Promise<unknown>`); `createWebViewRef()`: `current getState subscribe`. Ref codes (5): `script_error native_error navigated unavailable hook_not_handled`.

**Bridge**: RN `handle(method, (params, sender))`, `call(method, params?, {timeoutMs}?)`, `emit`, `on(event, (payload, sender))`; page `nativeBridge.{call,emit,handle,on}` (+ `__receive`); `createBridge<Methods, Events>({allowedOrigins, timeoutMs?})`. Codes (5): `timeout not_found handler_error navigated unavailable` (`navigated`, `unavailable` also ref codes).

**Hooks API** (Swift `ios/Hooks.swift`, Kotlin `android/.../Hooks.kt`):

| Member | Swift | Kotlin | Class |
|---|---|---|---|
| `register(key, configure?, attach)` | :25 | :44 | same |
| `configure` arg | `WKWebViewConfiguration`, before the view exists :27 | `WebView`, just made :30 | platform |
| `attach` returns | `(() -> Void)?` :14 | `((DocumentScope.End) -> Unit)?` :31 | accidental (A4-06) |
| view subclass | `webViewClass` :9 | `webViewFactory` :26 | platform |
| `options url emit ask onOptionsChange onDocumentEnd handle` | :52-69 | :71-100 | same (`[Any]` / `List<Any?>`) |
| lists | `navigationDelegates`, `uiDelegates` :57-58 (set re-assigns the delegate, MinimalWebView.swift:464-478) | `clients`, `chromeClients` :81-82 | platform |
| `activity` | none | `Activity?` :72 | platform; named in no doc (A4-04) |
| `emit`/`ask` threads | main only | any: hops to main, :144-146 | accidental (A4-05) |
| context after the view is gone | weak, no-op, ask answers nil :76,107 | strong :107 | platform (iOS WebView is torn down) |
| after a renderer crash | same WKWebView, no re-attach | new WebView, `attach` again | platform, documented |
| `End` cases | `.committed` | `COMMITTED` | platform spelling |

**Native module and routes**: view props 10 (iOS) / 9 (Android, no `sharedCookies`); events `onNavigationState onBridge onHookEvent onError onProcessGone onNavigation`; functions `navigate get call bridgePost answer hook evaluate`; module `warmUp preconnect defaultUserAgent` (Android). `core.*` routes: asks `navigationRequest fileRequest permissionRequest`, notifications `fullscreenChange download`, plus `warning`, `askCancelled`; `openExternal` is a gate only (WebView.tsx:81-88). Pinned by `nativeContract.test.ts`.
**Settings roots**: iOS settable `configuration preferences webpagePreferences webView scrollView`, get/call also `websiteDataStore httpCookieStore`; Android settable `settings webView`, get/call also `cookieManager webStorage` (PlatformSettings.swift:118-124, .kt:94-104; equal to types.ts and glossary.md:39-43).

**Conventions**: asks are `NavigationRequest FileRequest PermissionRequest`; notifications `NavigationEvent LoadErrorEvent ProcessGoneEvent FullscreenChangeEvent HookEvent`; exceptions `Download`, `DownloadFailure` (A4-08), `onOpenExternal(url: string)`. Discriminants: `kind` (`LoadErrorEvent`), `ok` (`Download`), key presence (`WebViewSource`, the internal `BridgeEvent`). Error codes are lowercase snake on both. Platform-only items are marked in the types except `didCrash` (A4-07).

## (b) Findings, ranked by impact

1. **A4-01 The crash guard's reset is wrong for Android in two docs.** props.md:18 and glossary.md:48-49: the guard stops reloads "until the next `source` change or `reload()`". Android clears it only in the ref's `reload()` (MinimalWebView.kt:233-237; `loadNewSource` :197 does not); iOS clears it on a new source too (MinimalWebView.swift:129, 194). CHANGELOG.md:45 and decisions.md:63-64 already say so. Quality 2, 3. Rec: document (name the platform split). S. Confidence high. Breaks: nothing.
2. **A4-02 `ref.hook` during the Android rebuild rejects `hook_not_handled`, not `unavailable`.** types.ts:253-258 and props.md:30-33 list `hook` with `evaluate`/`get`/`call`; the `hook` function never checks `recovering` (MinimalWebViewModule.kt:148-150), and `processGone` empties the contexts (MinimalWebView.kt:361, 279), so the lookup misses (:299). CHANGELOG.md:45 lists only `evaluate`, `get`, `call`. A caller reads `hook_not_handled` as "the hook isn't installed". Quality 2. Rec: simplify (code): one `if (view.recovering) return promise.reject("unavailable", RECOVERING, null)`, as `native()` does (:168-171). S. Confidence high. Breaks: nothing; the suites do not call `hook` mid-rebuild.
3. **A4-03 User docs claim one answer to the open Document-scope question, `decisions.md` the other.** props.md:16 and :67 say below WebView 146 "a load that never commits fires neither event"; decisions.md:30-31 says such a load "ends the Document spuriously" (a started load); MinimalWebViewClients.kt:116-117 and :118-119 say both, two lines apart. The plan says the question is "not claimed in user docs": it is. Quality 3, 4. Rec: test (probe a stopped and a 204 main-frame load on mrw-api36, WebView 133, then fix the wrong text). S. Confidence high that they disagree, none on which is right.
4. **A4-04 Three context members are in no doc.** native-hooks.md never names `uiDelegates` (Swift), `chromeClients` or `activity` (Kotlin), so a hook for dialogs, permissions or fullscreen (chrome client) can't be written from the doc; line 72 says only "use the lists". Still open from the 2026-10-21 docs-accuracy report. Quality 2, 5. Rec: document (one sentence per platform naming both lists and `activity`); the test below enforces it. S. Confidence high.
5. **A4-05 `emit`/`ask` are thread-safe on Android and main-only on iOS, and native-hooks.md says "Everything runs on the main thread" (:69).** Line 49-50 says `shouldInterceptRequest` runs on a background thread; Kotlin hops (Hooks.kt:119-122, 144-146), Swift does not (Hooks.swift:102-109). A hook that emits from a background queue (a `URLSession` completion, a `WKURLSchemeHandler`) is safe on Android and races `pendingAsks` on iOS. Quality 2, 4. Rec: simplify (3 lines: `DispatchQueue.main.async` when not on main, as Kotlin) and fix line 69. S. Confidence high. Breaks: nothing.
6. **A4-06 The detach closure differs in type, and `End` spells differently.** Swift `attach` returns `(() -> Void)?`, Kotlin `((End) -> Unit)?`. native-hooks.md:67 documents it ("on Android it gets `CRASHED` or `CLOSING`"). iOS detaches only at closing (MinimalWebView.swift:253-260), so a reason would always be `.closing`. A shared hook body must map `"\(reason)"` (Swift) and `reason.name.lowercase()` (Kotlin): the sample does (SampleExtensionModule.swift:19, .kt:27); native-hooks.md:61 gives only the lowercase set. Quality 2. Rec: keep, and list it as the one intentional difference; or give Swift the parameter (S, breaking, free). Confidence medium (taste).
7. **A4-07 `didCrash` is always true on iOS and the type and props.md don't say.** MinimalWebView.swift:421, 434; only ROADMAP.md:19 states it. Still open from api-surface F10. Quality 2. Rec: document (one clause in types.ts:98 and props.md:18) or delete the field (breaking, free). S. Confidence high.
8. **A4-08 The glossary states a naming rule the types don't all follow.** glossary.md:28-29 "an Ask's payload type is a `…Request`": a hook ask's is `HookEvent` (types.ts:245; `onHookEvent` serves asks and notifications). glossary.md:36 "told afterwards (a `…Event`)": `onDownload` gets `Download | DownloadFailure` (types.ts:188-200), `onOpenExternal` a bare string. Quality 2. Rec: document (say "result" for downloads; name `HookEvent` as the hybrid). Renaming `Download` loses clarity. S. Confidence high.
9. **A4-09 types.ts says the rebuild waits only for "the background".** types.ts:256-257 "(Android, while the app is in the background)"; props.md:32-33 "(in the background, or detached)"; `canRecover = isAttachedToWindow && !inBackground` (MinimalWebView.kt:380). Quality 2. Rec: document (types.ts). S. Confidence high.
10. **A4-10 "`onNavigation` reports every decision" omits hook-decided navigations.** navigation-rules.md:37 and migrating:211 vs types.ts:62-63 ("A navigation a native hook decides is not reported"; `deciding(...) ?: navigation.decide`, MinimalWebViewClients.kt:109-110). Quality 2. Rec: document. S. Confidence high.
11. **A4-11 Redirects of reload and back/forward: two docs differ.** navigation-rules.md:44-45: decided on Android only; migrating:211 "(their redirects don't)" without the platform. iOS skips the rules by `navigationType` (MinimalWebView+Navigation.swift:14), so a redirect that keeps `.reload`/`.backForward` probably skips them. Quality 2. Rec: test (a suite case, or word migrating:211 like navigation-rules.md). S. Confidence low.
12. **A4-12 props.md "Ref methods" (:23-25) lists seven of eight; `hook` is only in native-hooks.md and the error paragraph.** Quality 2. Rec: document. S. Confidence high.
13. **A4-13 Bridge nits.** An invalid per-call `timeoutMs` rejects a plain `RangeError` (endpoint.ts:57-58) though bridge.md:39 and types.ts:149-150 say calls reject with a `BridgeCallError`; bridge.md:68 "the same four methods" while the page object also has `__receive` (pageClient.ts:60). Quality 2. Rec: document (name the RangeError; call `__receive` internal). S. Confidence high.
14. **A4-14 A hand-made `Bridge` type-checks and silently injects nothing.** `Bridge` is structural (types.ts:139-164); `WebView` reads a symbol that only `createBridge` sets (WebView.tsx:294-295). Still open from api-surface F6. Quality 2. Rec: simplify (a brand: 2 lines in types.ts). S. Confidence medium. Breaks: test doubles of `Bridge`, if any.
15. **A4-15 The sample extension's keys are unprefixed, against the doc's advice.** `pageCounter`, `hookAuth`, `hookDialogs` (SampleExtensionModule.swift:10,24,28) vs native-hooks.md:36-37. Still open from hooks-mechanism 8. Quality 2. Rec: simplify (prefix `sample.`; example/harness.ts, example/App.tsx and the sample's src/index.ts follow). S. Confidence high.
16. **A4-16 Docs-to-code drift has no check beyond `nativeContract.test.ts`.** Rec: test, the block below. S. Confidence high that it runs; it fails today on A4-04 by design.
17. **A4-17 Keep: the conventions that hold.** Two error types (`BridgeCallError`, `CodedError`) share `navigated`/`unavailable` but stay separate vocabularies (WebView.tsx:272 builds the ref's with the bridge's `bridgeError`, typed to bridge codes: fine). The `Any?`/`Map<String, Any?>`/`[String: Any]` boundaries are the hook API (`options`, ask answers, `handle` args and reply, `emit` payloads: Hooks.swift:52,60-69; Hooks.kt:71,85-100) and `hookOptions`/`navigationRules` maps (MinimalWebViewModule.kt:112,115); each crosses JSON, so a typed alternative would be a per-hook generic with no runtime check. Rec: keep. Confidence medium.

## Proposed drift test (40 lines, prettier-clean; append to `nativeContract.test.ts`, reusing its `read`, `names`, `natives`, `ANDROID`)

Run in a scratch jest config: error-code and constant tests pass; the hook-context test fails on `uiDelegates`, `activity`, `chromeClients` (A4-04). Fix the doc first, then add it.

```ts
// Docs against code: the error codes, the hook context's members, the numbers the docs state.
const docs = ['props', 'bridge', 'native-hooks'].map((name) => read(`docs/${name}.md`)).join();
const section = (path: string, start: RegExp) => {
  const text = read(path);
  return text.slice(text.search(start)).split(/\n\}/)[0] ?? '';
};

test('every error code is in its type and the docs, and the ref codes are what native sends', () => {
  const ref = names(
    read('src/types.ts').match(/WebViewErrorCode =([^;]*);/)?.[1] ?? '',
    /'(\w+)'/g
  );
  const sent = names(natives, /(?:reject\(|failure\(|EvaluateError\((?:code: )?)"(\w+)"/g);
  expect([...new Set(sent)]).toEqual(ref);
  const bridge = read('src/bridge/protocol.ts').match(/ERROR_CODES = \[([^\]]*)\]/)?.[1] ?? '';
  [...ref, ...names(bridge, /'(\w+)'/g)].forEach((code) => expect(docs).toContain(`\`${code}\``));
});

test('the hook context is the same on both platforms bar the named extras, and native-hooks.md names all', () => {
  const swift = names(
    section('ios/Hooks.swift', /protocol WebViewContext/),
    /^\s+(?:var|func) (\w+)/gm
  );
  const kotlin = names(
    section(`${ANDROID}/Hooks.kt`, /interface WebViewContext/),
    /^\s+(?:val|fun) (\w+)/gm
  );
  const extras = ['navigationDelegates', 'uiDelegates', 'activity', 'chromeClients', 'clients'];
  const common = (members: string[]) => members.filter((member) => !extras.includes(member));
  expect(common(swift)).toEqual(common(kotlin));
  const hooksDoc = read('docs/native-hooks.md');
  expect([...swift, ...kotlin].filter((member) => !hooksDoc.includes(member))).toEqual([]);
});

test('the numbers the docs state are the ones both platforms use', () => {
  expect(natives).toMatch(/ASK_TIMEOUT_MS = 1000L[^]*askTimeout: TimeInterval = 1\b/);
  expect(natives).toMatch(/MAX_CRASHES_PER_WINDOW = 3[^]*CRASH_WINDOW_MS = 60_000L/);
  expect(natives).toMatch(/maxCrashesPerWindow = 3[^]*crashWindow: TimeInterval = 60/);
  expect(docs).toMatch(/more than 3 crashes in 60 s/);
});
```

## (c) Out of slice

- NavigationRules.swift:42-43 vs NavigationRules.kt:38: `about:` or `javascript:` with nothing after the colon has scheme `''` on Swift (checked with swiftc) and `about`/`javascript` on Kotlin, so Swift sends it to `external` in the main frame, Kotlin allows it; `navigation-rules.json` has no such case (B5: add a vector).
- ROADMAP.md:27 asks for "a changelog before outside use"; CHANGELOG.md exists.
- Fixed since 2026-10-21, not re-reported: `onHttpError`/`onLoad`, error codes, `ref` in `WebViewProps`, `ok` on downloads, stale-handle rejections, `nativeOptions` to `hookOptions` and `NativeEvent` to `HookEvent`, Android `configure`, hook order, `false` and the reserved `core`, weak iOS context, the main-thread hop, permission-frame wording, the SPI and Android defaults docs.

## (d) Questions only the maintainer can answer

1. A4-02: reject `unavailable` from `ref.hook` while Android rebuilds (one code line, matches the docs) or leave `hook_not_handled` and fix three doc places?
2. A4-06: is the detach reason the one intentional hooks difference, or should Swift's closure take `DocumentScope.End` (always `.closing`) so shared hook code compiles on both?
3. A4-07: keep `didCrash` (iOS always true) or delete it?
4. A4-03: who probes a stopped main-frame load on WebView 133 to settle the pre-146 text?

```json
{"id":"A4-01","file":"docs/props.md","line":18,"quality":[2,3],"claim":"crash guard reset 'source change or reload()' is iOS only; Android resets on reload() alone","recommendation":"document","size":"S","confidence":"high"}
{"id":"A4-02","file":"android/src/main/java/expo/modules/minimalwebview/MinimalWebViewModule.kt","line":148,"quality":[2],"claim":"ref.hook during the Android rebuild rejects hook_not_handled; types.ts and props.md say unavailable","recommendation":"simplify","size":"S","confidence":"high"}
{"id":"A4-03","file":"docs/props.md","line":16,"quality":[3,4],"claim":"user docs say a pre-146 load that never commits fires no events; decisions.md and a Kotlin comment say it ends the Document","recommendation":"test","size":"S","confidence":"high"}
{"id":"A4-04","file":"docs/native-hooks.md","line":72,"quality":[2,5],"claim":"uiDelegates, chromeClients and activity are named in no doc","recommendation":"document","size":"S","confidence":"high"}
{"id":"A4-05","file":"docs/native-hooks.md","line":69,"quality":[2,4],"claim":"emit/ask are thread-safe on Android only; doc says everything runs on main","recommendation":"simplify","size":"S","confidence":"high"}
{"id":"A4-06","file":"ios/Hooks.swift","line":14,"quality":[2],"claim":"attach's detach closure takes the End reason on Kotlin only; End cases spelled differently","recommendation":"keep","size":"S","confidence":"medium"}
{"id":"A4-07","file":"src/types.ts","line":98,"quality":[2],"claim":"didCrash is always true on iOS; only ROADMAP says so","recommendation":"document","size":"S","confidence":"high"}
{"id":"A4-08","file":"docs/glossary.md","line":28,"quality":[2],"claim":"glossary says asks are ...Request and notifications ...Event; HookEvent, Download and onOpenExternal(url) are not","recommendation":"document","size":"S","confidence":"high"}
{"id":"A4-09","file":"src/types.ts","line":256,"quality":[2],"claim":"rebuild wait is 'the background' only; props.md adds detached; code is not attached or in background","recommendation":"document","size":"S","confidence":"high"}
{"id":"A4-10","file":"docs/navigation-rules.md","line":37,"quality":[2],"claim":"onNavigation reports every decision, but hook-decided navigations are not reported","recommendation":"document","size":"S","confidence":"high"}
{"id":"A4-11","file":"docs/migrating-from-react-native-webview.md","line":211,"quality":[2],"claim":"redirects of reload/back-forward are decided on Android only (navigation-rules.md) vs on both (migrating)","recommendation":"test","size":"S","confidence":"low"}
{"id":"A4-12","file":"docs/props.md","line":23,"quality":[2],"claim":"Ref methods list omits hook","recommendation":"document","size":"S","confidence":"high"}
{"id":"A4-13","file":"src/bridge/endpoint.ts","line":58,"quality":[2],"claim":"invalid per-call timeoutMs rejects an uncoded RangeError; page object has an undocumented __receive","recommendation":"document","size":"S","confidence":"high"}
{"id":"A4-14","file":"src/types.ts","line":139,"quality":[2],"claim":"a hand-made Bridge type-checks and silently injects nothing","recommendation":"simplify","size":"S","confidence":"medium"}
{"id":"A4-15","file":"example/modules/sample-extension/ios/SampleExtensionModule.swift","line":10,"quality":[2],"claim":"sample hook keys are unprefixed against native-hooks.md advice","recommendation":"simplify","size":"S","confidence":"high"}
{"id":"A4-16","file":"src/__tests__/nativeContract.test.ts","line":312,"quality":[3],"claim":"no docs-to-code check for error codes, hook context members or documented numbers","recommendation":"test","size":"S","confidence":"high"}
{"id":"A4-17","file":"src/types.ts","line":259,"quality":[2],"claim":"error types, discriminants and Any? boundaries follow the conventions; keep","recommendation":"keep","size":"S","confidence":"medium"}
```
