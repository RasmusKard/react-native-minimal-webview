# C1 verification: ts-and-tooling (HEAD 8c0c1ca)

CONFIRMED 8 (B2-08, B2-10, B2-13, B2-15, B3-05, B3-13, B5-1, B5-9), REFUTED 1 (B3-12), PLAUSIBLE 0.
Corrections: B3-13's rename would hide its 6 warnings (ESLint doesn't lint `.mts`); B5-1's rule keys and actions are already pinned Kotlin to Swift by the vectors; B3-12's settle() barrier would replace about 27 of the 62 sleeps, not most.
New: on Android, `ref.hook` during the rebuild wait rejects `hook_not_handled`, but props.md:31-33 says `unavailable` (under B2-08).

Method: read every cited line and its callers at HEAD. Ran ESLint (read-only), jest and tsc only in a `mktemp -d` copy.
A grep on 2026-10-23 printed B2-08's and A4's paragraphs (B2-interfaces.md:44, A4-interfaces.md:49-52) before I
excluded `docs/audit`. I checked each of their seven points against the code myself.

## B2-08: seven doc gaps (src/types.ts:98). CONFIRMED

1. iOS sends `didCrash: true` always (ios/MinimalWebView.swift:421, :434). types.ts:97-98 and docs/props.md:18 don't
   say so. Only ROADMAP.md:20 does.
2. types.ts:256-257 says the rebuild waits "while the app is in the background". The code waits for the background *or*
   a detached view (`canRecover`, android/.../MinimalWebView.kt:380). props.md:32-33 is right.
3. "`onNavigation` reports every decision" (docs/navigation-rules.md:37, docs/migrating-from-react-native-webview.md:211).
   A hook-decided navigation isn't reported (MinimalWebViewClients.kt:109-110; types.ts:61-62 says so).
4. props.md:23-25 lists the ref methods without `hook`, which types.ts:396 has.
5. An invalid per-call `timeoutMs` rejects with a plain `RangeError` (src/bridge/endpoint.ts:57-58). bridge.md:39 and
   types.ts:149-150 promise a `BridgeCallError`. bridge.md:68 says "the same four methods", but the page object also
   has `__receive` (src/bridge/pageClient.ts:60).
6. Setting a `source` equal to the loaded one doesn't load it (ios/MinimalWebView.swift:126; MinimalWebView.kt:198-199).
   Neither props.md:5 nor types.ts:14-20 says so.
7. native-hooks.md:58 says "Double or Int (Kotlin)", per path it differs:
   - `hookOptions` and ask answers go through Expo's `Any` converter (MinimalWebViewModule.kt:115, :144), which gives
     `Double` (node_modules/expo-modules-core/android/.../AnyTypeConverter.kt:22).
   - `hook` args go through org.json (MinimalWebViewModule.kt:152, :184-189), which gives `Int`, `Long` or `Double`.
   - `Long` is not documented at all.
- Extra, found while checking item 2: `processGone` empties `hookContexts` (MinimalWebView.kt:361, :279), so during the
  wait `hookHandler` returns null (:299) and `ref.hook` rejects `hook_not_handled` (MinimalWebViewModule.kt:148-150).
  props.md:31-33 says `evaluate`, `get`, `call` and `hook` all reject `unavailable` then. Smallest fix: check
  `view.recovering` before `hookHandler` (2 lines, Kotlin), or fix the doc instead.
- Smallest change: one sentence each in the files above. Size S.
- Breaks: nothing. The extra Kotlin fix changes the rejection code from `hook_not_handled` to `unavailable`. No test or
  suite asserts it.

## B2-10: no docs-to-code check (src/__tests__/nativeContract.test.ts:22). CONFIRMED

- No test reads `docs/*.md`. Grepping src/__tests__, android/src/test and ios/Tests finds only a comment
  (MinimalWebViewClientsTest.kt:11).
- Native error codes are not pinned to `WebViewErrorCode` (types.ts:259-260). Native uses `reject("…")` and
  `EvaluateError`/`failure("…")`: 5 codes in ios/MinimalWebViewModule.swift:48-91, ios/MinimalWebView+Scripts.swift:29-51,
  MinimalWebViewModule.kt:150-175 and MinimalWebViewScripts.kt:102-132. They agree today.
- The `WebViewContext` members (ios/Hooks.swift:50-70, Hooks.kt:69-100) aren't compared by any test.
- Not verified: "A4's 40-line test holds at HEAD". That test is in a report this phase may not read.
- Smallest change, in nativeContract.test.ts (merge it with B5-1):
  - an error-code test, about 6 lines: the set of native codes equals a `Record<WebViewErrorCode, 1>`;
  - a context-member test, about 8 lines: Swift vs Kotlin members, with the documented platform-only lists.
  - Pinning numbers from the prose (1 s, 10 s, 3 in 60 s, 5 s) costs more than it catches.
  - Size S.
- Breaks: nothing. The regexes break if the native code is restructured.

## B2-13: a hand-made Bridge type-checks and injects nothing (src/types.ts:139). CONFIRMED

- `Bridge` is public (src/index.ts:5) and has only `handle`, `call`, `emit` and `on` (types.ts:139-164).
- WebView.tsx:294-295 reads `[CONNECTION]` through a cast. A hand-made object yields `undefined`. Then no
  `bridgeScript` or `bridgeOrigins` (:361-362), no attach (:297), and no warning.
- Smallest change, tried in a temp copy:
  - types.ts: `import type { BridgeConnection, CONNECTION } from './bridge/createBridge'` and
    `readonly [CONNECTION]: BridgeConnection` in `Bridge`;
  - WebView.tsx:294-295 becomes `props.bridge?.[CONNECTION]` (the cast goes).
  - Results: `tsc -p src/__tests__/tsconfig.json` passes, with a `@ts-expect-error` hand-made Bridge.
    `tsc -p tsconfig.json` emits `readonly [CONNECTION]` in types.d.ts. jest: 168 tests pass (nativeContract can't run
    in the copy).
  - About 4 lines. Size S. A 2-line `__DEV__` warn is the runtime-only alternative.
- Breaks: a consumer's hand-made or mock `Bridge` no longer compiles (intended). `BridgeConnection` shows in the
  emitted d.ts. knip, bridgeTypes.test.ts:32 and createBridge.test.ts:7 are unaffected.

## B2-15: the sample extension's gaps (example/modules/sample-extension/ios/SampleExtensionModule.swift:10). CONFIRMED

- The keys are unprefixed (`pageCounter`, `hookAuth`, `hookDialogs`: Swift :10/:24/:28, Kotlin
  SampleExtensionModule.kt:19/:33/:37). docs/native-hooks.md:37 says "prefix yours with your package's name", and :6
  calls the sample "a complete one".
- Neither file calls `context.ask` or `context.url`. iOS reads `webView.url` instead (:92, :96).
- Kotlin registers without `configure` (.kt:19). Swift has one (:10-12).
- iOS emits `documentEnd` for every reason, `closing` included (:19). Kotlin skips `CLOSING` (.kt:26-27). The JS type
  allows only `'committed' | 'crashed'` (example/modules/sample-extension/src/index.ts:14).
- No hook `ask` runs on device: the sample has none.
- Smallest change, size S:
  - prefix the 3 keys;
  - filter `.closing` on iOS (1 line);
  - add a Kotlin `configure` and one `context.ask` + `context.url` use (about 10 lines per platform).
- Breaks: example/harness.ts (10 lines name the keys, :2175-2233), example/App.tsx (2), the event names in
  src/index.ts:11-17, the `sampleExtension` suite, and a native rebuild of the example app.

## B3-05: WebView.tsx survivors (src/WebView.tsx:389). CONFIRMED

- 389:19 (`ref || typeof ref === 'object'`, filed `equivalent` in A5-survivors.tsv) dies with `ref={null}`. I ran a
  `render({ ref: null })` probe in a temp copy.
  - On the mutant it throws "Invalid value used as weak map key" at WebView.tsx:193.
  - On HEAD it passes.
- 467 is dead. jest-expo defaults to `ios`, the only override is `android` (WebView.test.tsx:283), and the view is
  native-only.
- The bridge glue (:294-306, 17 survivors) and the creation key's bridge id (:423-426, 7 survivors) have no test.
  WebView.test.tsx never passes `bridge`, and its expo mock has no `bridgePost` (:22-31).
- Spot-checks of `equivalent` rows hold: 300:6 (one connection per instance), 390:77 (`handle` is a useState value),
  424:63 (ids only need to be unique), 389:26.
- "15 of 16 checked": I can't tell which 16 rows were checked. The spot-checks above agree with it.
- Smallest change, size S (about 35 test lines): add `bridgePost` to the mock; one `describe('bridge')` (the script
  and origins reach native, a message gets its handler's answer through `bridgePost`, `navigated`/`unavailable` reach
  the connection, detach at unmount, the same bridge doesn't remount and a new one does via `mockMount`); one
  `ref={null}` render; delete line 467.
- Breaks: nothing. Deleting 467 sends Android-shaped settings on a platform the package doesn't support. The Stryker
  `WebView.tsx` score rises (65.8% today).

## B3-12: harness sleeps (example/harness.ts:2484). REFUTED

- 2505 lines: holds (`wc -l`).
- Sleeps: 63 `sleep(<literal>)` calls, 62 without `sleep(0)` (:335). Together they come to 38.81 s, not 34.8 s.
  34.8 s leaves out the two `Promise.race` timeouts (:578 3 s, :1063 1 s), which elapse only on failure. That makes
  60 sleeps, not 62.
- "A settle() barrier after setProps removes most" does not hold. Only about 27 sleeps (about 11 s) follow an
  `h.setProps`, `setRules` or `setAsk` (e.g. :189, :947, :1029-1077, :1340-1531, :1677, :1766-1829, :1927-2137). Of the
  rest:
  - :536 and :2344 are deliberate absence windows ("a duplicate would come right after", "a late … event would come
    now");
  - :2408 waits for a page timer;
  - :259 is a 10 ms poll step;
  - :354 is the handler's deliberate late answer;
  - the others follow clicks, `evaluate` navigations or `openPage`.
- On Android the barrier itself is unproven: Fabric applies props in a frame callback, and a MAIN-queue `AsyncFunction`
  can run before it.
- Smallest change: a `settle(h)` helper (a promise App.tsx resolves in an effect after commit, then one native round
  trip) for those 27 only. Size M. It needs on-device runs on both platforms.
- Breaks: suite timing, and flakiness where a barrier returns before native applied the prop. App.tsx changes.

## B3-13: build-page-client.mjs (.github/scripts/build-page-client.mjs:1). CONFIRMED; the recommendation hides the warnings

- It is the only tracked `.mjs` (`git ls-files '*.mjs'`). ESLint today reports 26 warnings, 0 errors. 6 of them are in
  this file, all `prettier/prettier` (:9, :10, :11, :12, :15, :21).
- ESLint ignores `.mts`: `npx eslint .github/scripts/gen-platform-types.mts` prints "File ignored because no matching
  configuration was supplied", and eslint.config.cjs has no `.mts` pattern. A rename alone makes the 6 warnings vanish
  unfixed. The 475-line gen-platform-types.mts is never linted today.
- Smallest change: rename it to `.mts`, typing `compile` as `(file: string)` (:8, implicit any today), and run Prettier
  on it.
  - Add `'**/*.mts'` to an eslint.config.cjs `files` entry. That also starts linting gen-platform-types.mts, with an
    unknown number of new warnings.
  - Prettier alone clears the 6 warnings without a rename. But the memory note says agent-guard blocks implicit-any
    `.mjs` edits, so the rename is the way to edit the file at all.
  - Size S.
- Breaks: package.json:33; the script's own :4, :18 and :21; src/bridge/pageClient.generated.ts:1 (its header names
  the script: regenerate it, or `--check` fails); comments at src/bridge/endpoint.ts:3 and src/bridge/pageClient.ts:2;
  .github/workflows/test.yml:22, off-limits under plan §0, so it goes stale.

## B5-1: hand-mirrored names, unpinned (src/__tests__/nativeContract.test.ts:60). CONFIRMED, one correction

- Each name below is a string literal on both sides and in no test. All agree with the TS types today:
  - `outcome`: MinimalWebViewClients.kt:67-69, :132; ios/MinimalWebView.swift:413, :428;
  - error `kind`: MinimalWebViewClients.kt:154-187; ios/MinimalWebView.swift:342, :371;
  - record fields: MinimalWebViewModule.kt:205-214; ios/MinimalWebViewModule.swift:99-108;
  - settings roots: PlatformSettings.kt:39, :94-104; ios/PlatformSettings.swift:118-124;
  - navigate verbs: MinimalWebViewModule.kt:127-130; ios/MinimalWebViewModule.swift:31-34;
  - transport names: MinimalWebViewScripts.kt:54, :160; ios/MinimalWebView.swift:217; MinimalWebView+Scripts.swift:67;
    pageClient.ts:13-18, :60;
  - permission resources: Permissions.kt:26, :66-68; MinimalWebView+Dialogs.swift:57-59.
- Request gates are pinned only as a union over both platforms (nativeContract.test.ts:57-65). iOS gates `download`,
  `navigationRequest`, `openExternal` and `permissionRequest`; Android adds `fileRequest` and `fullscreenChange`. A
  gate dropped on one platform passes.
- Correction: rule keys and actions are already pinned Kotlin to Swift. The shared vectors' rulesets use all 8 keys
  and all 4 actions, plus an invalid one (src/__tests__/vectors/navigation-rules.json). NavigationRulesTest.kt:9-23
  and ios/Tests/main.swift:12-14 read them through symlinks. Only TS to native is unpinned.
- Smallest change, in nativeContract.test.ts, size S:
  - a table of `Record<Union, 1>` rows, each asserting `"member"` appears in each platform's sources (about 15 lines for
    all; presence only, no exactness);
  - per-platform gates with `ANDROID_ONLY_REQUESTS` (about 4 lines);
  - for keys and actions, 3 lines checking the vector rules' keys against `keyof NavigationRule`.
- Breaks: nothing. The regexes break if the native code is restructured.

## B5-9: the ref store in WebView.tsx (src/WebView.tsx:171). CONFIRMED

- 106 lines holds: :171-246 (76: `INITIAL_STATE`, `Attachment`/`Adapter`, `adapters`, `createAdapter`,
  `createWebViewRef`) + :379-400 (22: `useAttach`) + :526-533 (8: `useWebViewState`).
- The rest uses only `INITIAL_STATE` (:481), `Attachment` (:264, :480) and the `useAttach` call (:290), which moves with
  the store.
- The store touches no `NativeProps`/`NativeMethods`, no settings and no load events. nativeContract.test.ts:28 reads
  WebView.tsx's text, but only for the JSX, `REQUESTS` and the `native.current?.` calls (:50-58), which stay.
- "Reads better" is a judgement. The facts behind it hold.
- Smallest change: move those ranges into `src/refStore.ts`, export `INITIAL_STATE`, `Attachment` and `useAttach`, and
  re-export the two public functions from WebView.tsx or point index.ts:1 at them. Size S.
- Breaks: no public API. Imports in index.ts:1 and WebView.test.tsx:5 (unless re-exported). The plan's file map. The
  Stryker `--mutate src/WebView.tsx` report now also needs the new file.

```json
[
 {"id":"B2-08","verdict":"CONFIRMED","evidence":"didCrash: MinimalWebView.swift:421,434 vs props.md:18 (ROADMAP.md:20 only); canRecover MinimalWebView.kt:380 vs types.ts:256-257; navigation-rules.md:37, migrating:211 vs MinimalWebViewClients.kt:109-110; props.md:23-25 lacks hook; endpoint.ts:57-58 RangeError vs bridge.md:39; pageClient.ts:60 __receive vs bridge.md:68; MinimalWebView.swift:126, MinimalWebView.kt:198-199 vs props.md:5; AnyTypeConverter.kt:22 Double vs org.json Int/Long/Double (MinimalWebViewModule.kt:152,184-189) vs native-hooks.md:58. Extra: hook during the Android rebuild wait rejects hook_not_handled (MinimalWebView.kt:279,299,361; MinimalWebViewModule.kt:148-150) vs props.md:31-33","smallest_change":"one sentence per gap in props.md, types.ts, navigation-rules.md, migrating, bridge.md, native-hooks.md; optionally check view.recovering before hookHandler (2 Kotlin lines)","size":"S","breaks":"nothing (docs); the Kotlin fix changes hook's rejection code during the rebuild wait"},
 {"id":"B2-10","verdict":"CONFIRMED","evidence":"no test reads docs/*.md (src/__tests__, android/src/test, ios/Tests); native error codes (MinimalWebViewModule.swift:48-91, MinimalWebViewScripts.kt:102-132, MinimalWebViewModule.kt:150-175) unpinned to types.ts:259-260; Hooks.swift:50-70 vs Hooks.kt:69-100 untested. The 'A4 40-line test holds' part is in a report this phase may not read","smallest_change":"in nativeContract.test.ts: an error-code set test (~6 lines) and a Swift/Kotlin context-member test (~8 lines); skip prose numbers; merge with B5-1","size":"S","breaks":"nothing; the regexes break if the native code is restructured"},
 {"id":"B2-13","verdict":"CONFIRMED","evidence":"Bridge has only handle/call/emit/on (types.ts:139-164); WebView.tsx:294-295 casts to read [CONNECTION], so a hand-made one gives undefined: no bridgeScript (:361-362), no attach (:297), no warning","smallest_change":"types.ts: readonly [CONNECTION]: BridgeConnection via import type; WebView.tsx:294-295 becomes props.bridge?.[CONNECTION]; tried in a temp copy: tsc (tests and build) pass, jest 168 pass","size":"S","breaks":"a consumer's hand-made or mock Bridge no longer compiles (intended); BridgeConnection appears in the emitted types.d.ts"},
 {"id":"B2-15","verdict":"CONFIRMED","evidence":"unprefixed keys SampleExtensionModule.swift:10,24,28 and .kt:19,33,37 vs native-hooks.md:37 and :6; no context.ask or context.url; no Kotlin configure (.kt:19); iOS emits closing (:19) where Kotlin filters it (.kt:26-27), and index.ts:14 types only committed|crashed","smallest_change":"prefix the 3 keys; filter .closing on iOS; add a Kotlin configure and one context.ask and context.url use","size":"S","breaks":"harness.ts (10 lines, :2175-2233), App.tsx (2), sample src/index.ts event names, the sampleExtension suite, a native rebuild of the example app"},
 {"id":"B3-05","verdict":"CONFIRMED","evidence":"a ref={null} probe kills 389:19 (WeakMap set throws at WebView.tsx:193) and passes at HEAD; 467 unreachable (jest-expo ios default, the only override is android at WebView.test.tsx:283); no bridge test in WebView.test.tsx and no bridgePost in its mock (:22-31); spot-checked equivalents 300:6, 390:77, 424:63, 389:26 hold","smallest_change":"add bridgePost to the mock; one describe('bridge') for the glue and creation-key identity (~30 lines); a ref={null} render; delete line 467","size":"S","breaks":"nothing; 467's removal only matters off iOS and Android; the Stryker WebView.tsx score rises"},
 {"id":"B3-12","verdict":"REFUTED","evidence":"2505 lines holds; 63 literal sleeps (62 without sleep(0) at :335) total 38.81 s; 34.8 s leaves out the race timeouts at :578 and :1063 (60 sleeps). Only ~27 (~11 s) follow setProps/setRules/setAsk; the rest are absence windows (:536, :2344), a page timer (:2408), a poll step (:259), a deliberate late answer (:354) and waits after clicks or navigations","smallest_change":"a settle(h) barrier (an effect-resolved promise in App.tsx plus a native round trip) for those ~27 only; prove it on Android, where Fabric applies props in a frame callback","size":"M","breaks":"on-device suite timing and flakiness; App.tsx; needs runs on both platforms"},
 {"id":"B3-13","verdict":"CONFIRMED","evidence":"the only tracked .mjs; ESLint: 26 warnings, 6 in this file, all prettier/prettier (:9-12,15,21); ESLint ignores .mts ('File ignored because no matching configuration was supplied' for gen-platform-types.mts), so a bare rename hides the warnings","smallest_change":"rename to .mts with (file: string) at :8, run prettier on it, add '**/*.mts' to an eslint.config.cjs files entry (which also lints gen-platform-types.mts)","size":"S","breaks":"package.json:33, the script's own :4,:18,:21, regenerate pageClient.generated.ts (header line 1), comments at endpoint.ts:3 and pageClient.ts:2, .github/workflows/test.yml:22 (off-limits, goes stale); new warnings from the 475-line gen-platform-types.mts"},
 {"id":"B5-1","verdict":"CONFIRMED","evidence":"outcome, kind, record fields, settings roots, navigate verbs, transport names and permission resources are literals on both sides with no test, and agree today; gates are pinned only as a union (nativeContract.test.ts:57-65; iOS 4 gates, Android 6). Correction: rule keys and actions are pinned Kotlin to Swift by vectors/navigation-rules.json (NavigationRulesTest.kt:9-23, ios/Tests/main.swift:12-14); only TS to native is unpinned","smallest_change":"in nativeContract.test.ts: a table of Record<Union,1> presence checks per platform (~15 lines), per-platform gates with ANDROID_ONLY_REQUESTS (~4), and the vector rule keys vs keyof NavigationRule (3)","size":"S","breaks":"nothing; presence-only checks miss an extra native value; the regexes break if the native code is restructured"},
 {"id":"B5-9","verdict":"CONFIRMED","evidence":"106 = WebView.tsx:171-246 (76) + 379-400 (22) + 526-533 (8); the rest uses INITIAL_STATE (:481), Attachment (:264,:480) and the useAttach call (:290); nativeContract.test.ts:28,50-58 reads only parts that stay","smallest_change":"move those ranges to src/refStore.ts and export INITIAL_STATE, Attachment and useAttach; re-export or repoint index.ts:1","size":"S","breaks":"no public API; imports in index.ts:1 and WebView.test.tsx:5; the plan's file map; the Stryker --mutate scope for WebView.tsx"}
]
```
