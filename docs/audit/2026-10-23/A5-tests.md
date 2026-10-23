# A5 test map and WebView.tsx mutation survivors (audit-2026-10-23 @ 333f05f)

## (a) Summary

1. Laptop tests cover whole files for 82 of 1710 Kotlin code lines (the rule matcher, `DocumentScope`) and 108 of 1176 Swift
   (the two matchers, `DocumentScope`), plus three small Kotlin functions; the other 90% or more of native code is checked only by
   the 20 on-device suites (244 check sites: iOS runs 199, Android 215). The TS side is well covered (199 jest tests).
2. Stryker on `src/WebView.tsx`: 65.8% (221 killed, 115 survived of 336). The survivors are 91 untested, 23 equivalent, 1 dead.
   One test file of 17 tests (316 lines with its mock, `A5-proposed-tests.txt`, not committed) kills 85 of the 115, checked by
   applying each mutant by hand: 91.1%, or 98.1% once the 24 unkillable ones are left out.
3. The gaps that matter: the WebView-to-bridge glue (it hands native's verified origin to the bridge) and the bridge in the
   creation key have no jest test; no test leaves a callback prop unset; `warmUp`, `preconnect`, `progress`, `didCrash` and callback refs are tested nowhere.

## Measured

- jest (`npx jest --coverage`): 7 suites, 199 tests: WebView 28, nativeContract 31, originRules 91 (38 `createBridge` validation, 53 page client),
  createBridge 25, protocol 17, pageClient 6, bridgeTypes 1 (type-level). Line coverage: `WebView.tsx` 92.1% (branches 84.7%), `src/bridge` 100% (95.3%).
  Uncovered in `WebView.tsx`: 165, 276-278, 298-299, 303-305, 509, 516, 523.
- JVM: 11 tests in 6 classes, 0 failures (`android/build/test-results`, `A1-gradle-test.txt`): NavigationRulesTest on the vectors (72 cases, 7 answers), CrashLoopTest 7 cases,
  ShowsSourceTest 10, HooksTest 3 (`overrides`), MinimalWebViewClientsTest 2 (reflection: every platform callback is overridden), DocumentScopeTest 2.
- swiftc (`ios/Tests/main.swift`, run in a scratch dir): 79 navigation, 53 origin, 5 `origin()`, 2 scope cases, all pass. It compiles 3 of 13 Swift files.
- Stryker: `npx stryker run --mutate src/WebView.tsx --reporters clear-text,html`, 11 s, 28 tests per mutant, exit 1 (65.77 < 80). Output: `A5-stryker-output.txt`;
  the HTML report is in `reports/mutation/` (gitignored). `npm run mutation` (the `src/bridge` gate) was not re-run: one Stryker run only.
- Device: `SUITES` at `example/harness.ts:2484`, 20 suites; 244 check sites (229 `r.check`, 9 version-gated, 6 `agree`). Android-only 45, iOS-only 29.
  Per suite, per platform, with the Kotlin, Swift and TS functions each exercises: `A5-suite-map.tsv`.
- Since 2026-10-21 (`test-strategy.md`): fixed, WebView 133 known limits report as INFO (`harness.ts:222`, 9 sites), load-event ordering has jest tests
  (`WebView.test.tsx:95-115`), Android settings defaults too (`:282-312`), `development.md` states which matcher runs where, the Stryker gate is 80 and includes
  `pageClient.ts` (`stryker.config.json:7-9`), `backForward` and `overlays` are merged (22 suites to 20). Unchanged: the ask timeout, late answer and cache population
  are device-only, `PlatformSettings` coerce is device-only, `warmUp`, `preconnect`, `progress` and `didCrash` are tested nowhere, `harness.ts` is one file
  (2212 to 2505 lines) with 62 `await sleep(` (34.8 s of literal sleeps; was 58, 34 s).

## Test map: source file to tests (code lines from cloc)

| Source | Laptop tests | On-device suites (functions in `A5-suite-map.tsv`) |
|---|---|---|
| `WebView.tsx` 533 | `WebView.test.tsx` 28; names and payload keys in nativeContract; Stryker 65.8% | every suite |
| `bridge/createBridge.ts`, `endpoint.ts`, `protocol.ts` | createBridge 25, protocol 17, originRules 38; Stryker gate (not re-run) | bridge, bfcache, crash |
| `bridge/pageClient.ts` | pageClient 6, originRules 53 vectors, the injected script in createBridge | bridge, bfcache |
| `pageClient.generated.ts`, `platform.generated.ts` | none in jest; `--check` by hand (both clean now) | - |
| `types.ts`, `index.ts` | bridgeTypes (types), `satisfies` rows in nativeContract; `index.ts` none | - |
| `NavigationRules.kt` 73, `.swift` 78 | vectors: 72 cases + 7 answers on both | navigation, reissue, errors |
| `OriginRules.swift` 20 | vectors 53 + 5 `origin()` (swiftc), TS side of the vectors | bridge (origin handed to handlers) |
| `DocumentScope.kt` 9, `.swift` 10 | 2 cases each, written twice (no shared vector) | bridge, upload, permissions, fullscreen, bfcache |
| `MinimalWebView.kt` 354 | `showsSource` 10, `crashAllowsReload` 7 only | urlTracking, crash, errors, ptr, upload, permissions, fullscreen, sources |
| `MinimalWebView.swift` 362, `+Navigation` 96, `+Dialogs` 77, `+Scripts` 67 | none (not in the swiftc build); iOS crash guard is inline | urlTracking, crash, errors, bridge, navigation, dialogs, permissions |
| `MinimalWebViewClients.kt` 271 | override presence only (2 reflection tests) | urlTracking, errors, bfcache, navigation, sampleExtension |
| `MinimalWebViewNavigation.kt` 129, `+Navigation.swift` | none: ask cache, 1 s timeout, late answer, external, new window | reissue 11, navigation 19, bfcache, errors |
| `MinimalWebViewScripts.kt` 117, `+Scripts.swift` | none | bridge 23, injection 8, crash, bfcache |
| `PlatformSettings.kt` 161, `.swift` 155, `MRWInvoke.m` 159 | none (`coerce` cyclomatic 24) | settings (iOS 25, Android 20), ua 4, mountSettings |
| `Hooks.kt` 106, `Hooks.swift` 85, `DelegateProxy.swift` 39 | `overrides` 3 tests; `enables` none on both | sampleExtension 11, crash (hooks re-attached) |
| `MinimalWebViewModule.kt` 164, `.swift` 87 | nativeContract (names, routes, payload keys; not `Name(`) | all |
| `requests/Downloads.kt` 135, `Downloads.swift` 53 | none | downloads 9, network 1 |
| `requests/Permissions.kt` 46 (`originOf`) | none | permissions 12 (Android 12, iOS 7) |
| `requests/FileUpload.kt` 20, `FullscreenVideo.kt` 74 | none | upload 9, fullscreen 6 (Android only) |
| `PullToRefresh.kt` 51, refresh control in `MinimalWebView.swift` | none | ptr 7 (swipes from the driver) |
| `SharedCookies.swift` 47 | none | network 3 cookie sites (iOS; Android shares natively) |
| Crash recovery (`processGone`, `recover`, `webViewWebContentProcessDidTerminate`) | guard counting Kotlin only | crash 19 (kills from the driver), fullscreen |

Share of code lines with a whole-file laptop test: Kotlin 82/1710 (4.8%), Swift 108/1176 (9.2%); with the three Kotlin functions about 6%.

## WebView.tsx survivors by function (115; every one in `A5-survivors.tsv` with class, test and value)

| Function | Lines | Survivors | Class |
|---|---|---|---|
| `keysOf` tables (`STATE_KEYS`, `NAVIGATION_KEYS`, `PROCESS_GONE_KEYS`) | 41-59 | 16 | equivalent: only the keys are read, never the `true` values |
| Bridge attach effect and `onBridge` | 294-306 | 17 | 16 untested (P3, P1); 1 equivalent (`[connection]` is stable: `creationKey` remounts on a bridge change) |
| Static API: `defaultUserAgent`, `warmUp`, `preconnect`, `nativeModule` and names | 163-169, 508-523 | 22 | untested (P10) |
| Ref handle (`goBack` ... `call` default) | 272-281 | 12 | untested (P7); 272 is a message string, 281 a default argument |
| Props of the native view (`pullToRefresh`, `sharedCookies`, `onProcessGone`) | 357-373 | 9 | untested (P6, P1) |
| `creationKey` and `sortedKeys` | 421-438 | 12 | 11 untested (P4, P5); `++lastBridgeId` to `--` equivalent |
| `onNavigation` | 345-349 | 6 | untested (P2, P1) |
| `onHookEvent` | 317-343 | 5 | 4 untested (P1; 337 a message string, 340 a leak); 342 `controller?.` equivalent (set whenever `askId` is) |
| `useAttach` | 383-400 | 4 | 389 x2 and 390 equivalent; 399 untested (P9, ref swap) |
| `asks` cleanup | 313-315 | 4 | 3 untested (P8); `[asks]` dependency equivalent |
| `createAdapter` | 197-236 | 3 | untested (P9: unsubscribe, seed on re-attach; 221 a message) |
| `useLoadEvents` | 480-499 | 3 | untested (P1: `?.` on `onLoadStart`, `onLoadEnd`, `onError`) |
| `answer` | 309 | 1 | untested, narrow window (ref cleared before the effect cleanup) |
| `platformSettings` | 467 | 1 | dead: `Platform.OS` neither ios nor android |

P1-P10 are the `describe` blocks of `A5-proposed-tests.txt`: P1 callbacks unset, P2 `onOpenExternal`, P3 bridge glue, P4 bridge in the creation key, P5 key order,
P6 `sharedCookies` and `pullToRefresh`, P7 ref handle, P8 asks at unmount, P9 ref objects and a callback ref, P10 static API and native names.

Totals: untested 91 (85 killed by P1-P10, 6 not: 3 message strings, `call` default args, `answer` and `bridgePost` after the ref is gone), equivalent 23, dead 1.
The three message-string mutants are not worth a test. The 24 unkillable are 21% of the survivors and cap the score at 92.9% without a `// Stryker disable` or a change to `keysOf`.

## (b) Findings, ranked by impact

**F1** (Q3) The WebView-to-bridge glue has no jest test. `WebView.tsx:294-306` attaches the bridge, posts to native and routes `onBridge` to
`receive(message, origin)`, `navigated()` and `markUnavailable()`. Lines 298-299 and 303-305 are uncovered; 16 mutants survive, among them an emptied attach effect (296)
and an emptied `onBridge` (302), the JS half of the origin handed to handlers. Only the device `bridge` suite (`harness.ts:457-587`) would notice.
Recommendation: **test** (P3, 4 tests, about 45 lines). Size S, confidence high. Breaks: nothing.

**F2** (Q3, Q5) A new bridge must recreate the WebView (its script and origins install at creation), and `creationKey` (`WebView.tsx:421-439`) does that by
bridge identity; no jest test and no device suite swaps a bridge (`harness.ts:36` has one `h.bridge`; `WebView.test.tsx:272-311` only changes `ios.configuration`).
11 survivors, including "the same bridge keeps the view" and "another key order keeps the view". A silent regression leaves the old `allowedOrigins` in force.
Recommendation: **test** (P4, P5). Size S, confidence high. Breaks: nothing.

**F3** (Q3) No test leaves a callback prop unset: the `render` helper passes `onLoadEnd` (`WebView.test.tsx:42`), the other tests pass what they check. A removed `?.` at
`WebView.tsx:326`, 334, 348, 373, 488, 489, 494 survives (10 mutants with the bridge ones); each throws in the event path of an app that omits that prop (most omit `onNavigation`,
`onProcessGone`, `onLoadStart`), or, for the hook-event handler, logs a spurious error. Recommendation: **test** (P1: bare `<WebView>`, fire every native event, expect no `console.error`; 1 test, 20 lines). Size S, confidence high. Breaks: nothing.

**F4** (Q2, Q3) `sharedCookies` is iOS-only (`nativeContract.test.ts:38`) and `WebView.tsx:358` sends `undefined` on Android so that Android never gets an undefined prop; its
default `false` and `pullToRefresh`'s (`:357`) are untested (8 survivors). `example/App.tsx:138-139` turns both on for every device run, so the off and Android paths are
checked nowhere. Recommendation: **test** (P6). Size S, confidence high. Breaks: nothing.

**F5** (Q2, Q3) `onOpenExternal` is told from `onNavigation` (`WebView.tsx:347`; `REQUESTS` says native never asks it): 5 survivors. Device only (`harness.ts:1613`, 1752, 1934).
Recommendation: **test** (P2). Size S, confidence high.

**F6** (Q2, Q5) The static API and the native binding names are unpinned: `defaultUserAgent`, `warmUp`, `preconnect` (22 survivors, `WebView.tsx:163-169`, 508-523). The jest mock
returns `defaultUserAgent` and nothing reads it (`WebView.test.tsx:35`); on device only Android `mountSettings` reads it (`harness.ts:1273`); `warmUp` and `preconnect` are
called by no test. `'MinimalWebView'` (view and module name) is not compared with `Name("MinimalWebView")` (`MinimalWebViewModule.kt:58`, `MinimalWebViewModule.swift:6`):
nativeContract reads `Prop` and `Function` only. Recommendation: **test** (P10, and one more regex in nativeContract). Size S, confidence high.

**F7** (Q3) `goForward`, `reload` and `stopLoading` are never called in jest (`WebView.tsx:276-278` uncovered, 10 survivors incl. the verb strings) and the stale-handle contract
(navigation is a no-op after unmount, comment at `:267`) is asserted for `evaluate`, `get`, `call`, `hook` only (`WebView.test.tsx:552-558`). Recommendation: **test** (P7). Size S, confidence high.

**F8** (Q3) Smaller TS holes, 7 mutants plus one unmutated path: asks in flight are aborted at unmount (`WebView.tsx:313-315`) and a finished ask leaves the map (340); the ref adapter's unsubscribe (212), its
seed on re-attach (225) and a changed `ref` prop (399); and no test renders a callback ref (`types.ts:354` allows one; Stryker cannot see it, since 389's mutants are equivalent). Recommendation: **test** (P8, P9). Size S, confidence high.

**F9** (Q3) Equivalent mutants are 20% of the survivors (23), 16 of them from `keysOf` (`WebView.tsx:41-59`), so a gate on `WebView.tsx` would sit about 7 points under its real score.
Recommendation: **document**: a `// Stryker disable next-line BooleanLiteral: only the keys are read` on the three tables (or take an array and check exhaustiveness with a type), then
add `src/WebView.tsx` to `mutate` (`stryker.config.json:7`) once P1-P10 land (91.1% raw). Size S, confidence medium (gate scope is the maintainer's call, question 1).

**F10** (Q3, Q5) What only a device checks: the navigation policy's timeout, late answer and cache population (`MinimalWebViewNavigation.kt:37-83`, `MinimalWebView+Navigation.swift:57-111`;
the matcher side, 5 `asked` and 3 `canAsk` vector cases, is tested), `PlatformSettings` coerce (`.kt:147`, `.swift:143`), `Downloads` (`Downloads.kt:53`), `Permissions.originOf`, the iOS crash guard
(`MinimalWebView.swift:424-426`; Kotlin's `crashAllowsReload` is tested), `showsSource` against `onSource` (`:164`), `enables` (`Hooks.kt:66`, `Hooks.swift:43`: the `NSNumber 0` case
is exactly where it would break). A3 F2, F5, F6, F10 name the seams. Recommendation: **test** the pure pairs now as shared vectors (`enables`, guard counting, `showsSource`; S each);
the rest needs A3's seams (M). Confidence medium. Breaks: `CrashLoopTest` and `ShowsSourceTest` would read the JSON.

**F11** (Q3) The two generated files are checked only by hand: `build-page-client.mjs --check` and `gen-platform-types.mts --check` both exit 0 now, but no jest test runs them and
`docs/development.md:26` says "CI fails when either is stale" while CI is off. Recommendation: **test** (a jest test that spawns both with `--check`, about 10 lines) or **document**
the two commands. Size S, confidence high.

**F12** (Q3) Tested nowhere on any layer: `WebView.warmUp`, `preconnect`, `progress`, `didCrash`, a callback ref, `sharedCookies` off, `pullToRefresh` unset, the iOS dialog
dismissed when its Document ends (`dialogs` presses OK three times), `microphone` and `protectedMedia` permission resources, `onFileRequest` with `multiple` or `capture` true.
Evidence: grep of `example/harness.ts` and `src/__tests__`. Recommendation: **test**: the first six in jest (P6, P9, P10), the rest one device check each. Size S, confidence medium (grep-based).

## (c) Out of slice

- `WebView.tsx:342` `controller?.` exists for the type checker only (`controller` is set whenever `askId` is): B4/B5 can restructure `onHookEvent` instead of testing it.
- A3 F6, F7, F10 already cover the twice-written logic and the sample extension's gaps; not repeated.
- `harness.ts` is one 2505-line file with 62 fixed sleeps (34.8 s a run); the 9 version-gated sites report INFO on WebView 133, so a regression there is invisible on the reference emulator (B3).
- `npm run mutation` on `src/bridge` was not re-measured (last: 86.6% on 3 files, 2026-10-21).

## (d) Questions for the maintainer

1. Does `src/WebView.tsx` join the 80% Stryker gate once P1-P10 are in (91.1%, 98.1% without the 24 unkillable)? And disable the 16 `keysOf` mutants by comment, or change `keysOf`?
2. P1-P10 as one new file with its own mock (316 lines) or folded into `WebView.test.tsx` (sharing its mock saves about 35 lines)?
3. Are platforms other than iOS and Android supported (`WebView.tsx:467`, `return {}`)? If not, delete the line; if so, test it.
4. Move the two generated-file `--check` runs into `npm test` now that CI is off (F11)?

```json
[
{"id":"F1","file":"src/WebView.tsx","line":294,"quality":3,"claim":"the WebView-to-bridge glue (attach, post, onBridge dispatch with the verified origin) has no jest test: 16 survivors, lines 298-299 and 303-305 uncovered","recommendation":"test","size":"S","confidence":"high"},
{"id":"F2","file":"src/WebView.tsx","line":421,"quality":3,"claim":"a changed bridge must recreate the WebView and a reordered config must not; no jest or device test swaps a bridge or reorders keys: 11 survivors","recommendation":"test","size":"S","confidence":"high"},
{"id":"F3","file":"src/WebView.tsx","line":348,"quality":3,"claim":"no test leaves a callback prop unset, so removing the ?. on onNavigation, onProcessGone, onLoadStart, onLoadEnd, onError or the hook handler survives","recommendation":"test","size":"S","confidence":"high"},
{"id":"F4","file":"src/WebView.tsx","line":358,"quality":2,"claim":"sharedCookies (iOS-only, undefined on Android) and the pullToRefresh default are checked nowhere; the example turns both on","recommendation":"test","size":"S","confidence":"high"},
{"id":"F5","file":"src/WebView.tsx","line":347,"quality":2,"claim":"onOpenExternal being told from onNavigation has no jest test, 5 survivors","recommendation":"test","size":"S","confidence":"high"},
{"id":"F6","file":"src/WebView.tsx","line":508,"quality":2,"claim":"defaultUserAgent, warmUp, preconnect and the native view and module names are untested or unpinned: 22 survivors","recommendation":"test","size":"S","confidence":"high"},
{"id":"F7","file":"src/WebView.tsx","line":276,"quality":3,"claim":"goForward, reload, stopLoading are never called in jest and stale-handle navigation is untested: 10 survivors","recommendation":"test","size":"S","confidence":"high"},
{"id":"F8","file":"src/WebView.tsx","line":315,"quality":3,"claim":"asks aborted at unmount, ask map cleanup, ref unsubscribe, ref swap are untested (7 survivors) and no test renders a callback ref","recommendation":"test","size":"S","confidence":"high"},
{"id":"F9","file":"stryker.config.json","line":7,"quality":3,"claim":"23 of 115 survivors are equivalent (16 from keysOf) and 1 is dead, so a WebView.tsx gate would read about 7 points low","recommendation":"document","size":"S","confidence":"medium"},
{"id":"F10","file":"ios/MinimalWebView.swift","line":424,"quality":3,"claim":"90% or more of native code is checked only on device; pure pairs (enables, crash guard counting, showsSource/onSource) could be shared vectors","recommendation":"test","size":"S","confidence":"medium"},
{"id":"F11","file":".github/scripts/build-page-client.mjs","line":20,"quality":3,"claim":"the two generated files are checked by --check only by hand; no jest test runs them and CI is off","recommendation":"test","size":"S","confidence":"high"},
{"id":"F12","file":"src/WebView.tsx","line":515,"quality":3,"claim":"warmUp, preconnect, progress, didCrash, callback refs, sharedCookies off and the iOS dialog dismissed at a Document end are tested on no layer","recommendation":"test","size":"S","confidence":"medium"}
]
```
