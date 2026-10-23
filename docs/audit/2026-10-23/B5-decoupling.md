# B5 Decoupled @ e400de9 (read-only; code identical to 333f05f, where A3 measured)

**Summary.** (1) Pass with items. On both platforms the view class is an aggregate root by design: Expo binds props, events and functions to it, and it owns the platform WebView, crash recovery, the Document scope, the navigation state and the hook plumbing. What accreted is small: the ask registry (both platforms, about 29 Kotlin and 20 Swift lines), Kotlin's file-chooser hold (14 lines) and some visibility leftovers. Core's request classes should not move onto the hook seam: 4 of the 6 additions they would need are core-only.
(2) Cross-layer names, routes and payload keys are pinned; values are not. 9 hand-mirrored value sets and the per-platform request gates all agree today (checked with a node prototype against HEAD). Each one pins in 3 to 6 lines of `nativeContract.test.ts`, about 45 lines in all.
(3) Cross-platform: two drifts have no vector (the Swift scheme of a bare `about:`, and `/page` vs `/page/` source detection), S each. A3's Swift `pendingAsks` "leak" is refuted, with one exception: an ask made after close never settles, on either platform (S fix). In `WebView.tsx`, one split (the 106-line ref store) helps a reader; the rest would only move lines.

## Verdict: pass with items

| Plan §1 row 5 test | Measured at HEAD |
|---|---|
| The view is an aggregate root by design | **Mostly.** Kotlin has 36 functions and 49 properties (A3's count): 29 functions by design, 7 accreted (ask registry 5, file chooser 2). Swift has 52 functions over 4 files (30 in the main file) and 47 stored properties (A3's count): the ask registry (3 functions, 2 properties) accreted. 10 properties are `internal` only because Swift extensions in other files need that. |
| Fan-in | Kotlin: 11 other files, 12 classes hold the view. Swift: A1's 8 files include the type's own three `+` files, so 4 real holders (Module, Hooks, Downloads, DelegateProxy) plus `WeakBridgeHandler`. |
| Narrowest dependency | Of A3's narrowings (F2, F3, F5), 2 are worth doing (B5-7). The rest come out the same size or buy nothing (B5-10). |
| Cross-layer pinned | 30 mirrors (A3 §5): 5 pinned, 8 partly, 17 unpinned. B5-1 pins 7 of the 17 (M14, M15, M18, M19, M22, M23, M25), the TS side of the partly pinned M16 and M17, and the per-platform half of M7 (A3 counts M7 as pinned; it is a union, `NC:60-65`). A4-16's test takes M12, M28 and M30 (and the partly pinned M29). Left: M8, M9 and M11 are one-line guards (a 2-line `toContain` each, if wanted); M20 needs a `satisfies` against the generated keys (6 lines; `userAgentString: null` at `WebView.tsx:471` doesn't fit the generated `string`); M27 is behaviour; M4 and M10 fail at build time or on device first. |
| Shared vectors | 7 cross-platform pairs. 2 have vectors (navigation and origin rules). 2 drift without one (B5-5). 3 have a stated reason not to (B5-5). |
| TS | 7 files, acyclic (A3 §4, re-read). `WebView.tsx` is 533 lines in 6 clusters (B5-9). |

Paths: `K/` = `android/src/main/java/expo/modules/minimalwebview/`; `KV` = `K/MinimalWebView.kt`; `KC` = `K/MinimalWebViewClients.kt`; `KM` = `K/MinimalWebViewModule.kt`; `KH` = `K/Hooks.kt`; `SV` = `ios/MinimalWebView.swift`; `SN`, `SS`, `SD` = its `+Navigation`, `+Scripts`, `+Dialogs`; `SM` = `ios/MinimalWebViewModule.swift`; `NC` = `src/__tests__/nativeContract.test.ts`.

## Findings, ranked

**B5-1. 9 cross-layer value sets and the per-platform gates are mirrored by hand and unpinned (Q5, Q3).**
`NC` reads names, routes and payload keys (`NC:41-67,290-311`). It reads no values. It also checks the request gates as a union of both platforms (`NC:60-65`), so dropping iOS's `download` gate (`ios/Downloads.swift:37`) passes. A Record field mismatch silently drops the whole prop (`SM:95`). Every pin below matches at HEAD (prototyped in node). Pins:

| # | TS | native | pin (regex over the cited files) | lines |
|---|---|---|---|---|
| M14 outcome | `src/types.ts:86` | `KV:370,422`; `KC:66-69,132`; `SV:413,428` | Kotlin `outcome = "(\w+)"\|-> "(\w+)"\|outcome \?: "(\w+)"` over KV+KC. Swift: the literals after `outcome =` in SV. Each == the union. Don't use a plain `toContain`: the comments at `KV:113` and `SV:75` name all three values. | 4 |
| M15 kind | `types.ts:93-95` | `KC:154,160,187`; `SV:342,371` | `reportError\("(\w+)"`; `"kind": (?:\w+ \? "(\w+)" : "(\w+)"\|"(\w+)")` (flatMap the groups) | 3 |
| M16 actions | `types.ts:25,48` | `K/NavigationRules.kt:17`; `ios/NavigationRules.swift:24` | the `actions` set literal == `NavigationAction` + `ask` | 3 |
| M17 rule keys | `types.ts:31-49` | `NavigationRules.kt:54,82-92`; `.swift:69,81-88` | `rules?(?:\[index\])?\["(\w+)"\]\|flag\(rule, "(\w+)"` == `{…} satisfies Record<keyof NavigationRule, 1>` | 4 |
| M18 records | `types.ts:21,107` | `KM:204-215`; `SM:98-109` | `@Field (?:val\|var) (\w+)` per record == a `satisfies Record<…, 1>` over the union's keys | 6 |
| M19 settings roots | `types.ts:215-239` (+ `get`/`call` extras, `types.ts:370-381`) | `K/PlatformSettings.kt:93-105`; `ios/PlatformSettings.swift:116-126` | `"(\w+)" -> listOf`; `case "(\w+)": return` inside `root(` == `keyof IOSSettings` / `AndroidSettings` + the 2 extras each | 5 |
| M22 verbs | `src/WebView.tsx:275-278` | `KM:126-131`; `SM:30-35` | `navigate\('(\w+)'\)` == `"(\w+)" -> view\.` == `case "(\w+)": view\.` | 3 |
| M23 transport | `src/bridge/pageClient.ts` | `K/MinimalWebViewScripts.kt:54`; `SV:217`; `SS:67` | 3 `toContain` | 3 |
| M25 resources | `types.ts:177` | `K/requests/Permissions.kt:26,65-69`; `SD:56-60` | Kotlin `to "(\w+)"\|listOf\("(\w+)"\)` == the union; Swift contains `camera`, `microphone` | 3 |
| M7 gates | `WebView.tsx:81-88` | `NC:61-64` | per platform: Android == `REQUESTS`, iOS == `REQUESTS` minus `ANDROID_ONLY_REQUESTS` (`fileRequest`, `fullscreenChange`), as with `IOS_ONLY_PROPS` (`NC:38`) | 6 |

M12 (error codes) is A4-16's first test; its regex matches all 5 codes on both platforms, so don't duplicate it. Helpers: 3 lines (a `flatMap` over capture groups and a `quoted(anchor)` reader of `types.ts`). Recommendation: **test**, S, ~45 lines appended to `NC`. Confidence high. Breaks: nothing. Afterwards, a literal changed on one side fails by name.

**B5-2. The view is an aggregate root by design. Say so, and name what belongs to it (Q5, Q4).**
Belongs by design, the same on both platforms:
1. The Expo surface: events (`KV:32-37`, `SV:5-10`), prop fields (`KV:56-77`, `SV:14-40`) and function receivers (`KM:108-162`, `SM:9-80`). Expo binds all three to the view instance.
2. The platform WebView's life: `KV:44-53,141-251,409-418`; `SV:44,115-277`.
3. Crash recovery: `KV:352-407,455-467`; `SV:420-436`.
4. The DocumentScope and its ends: `KV:40,127-139,340,360,413`; `SV:64,93-112,255,390,427`.
5. Navigation state, the package's premise (`docs/glossary.md:3`): `KV:107-116,420-453`; `SV:53-78,279-324`. On Android the clients write it, as `KV:107` already says. That is forced: Android has no KVO.
6. Hook plumbing: `KV:80-96,264-301`; `SV:45-51,443-484`. `HookContext` is the narrow facade (`KH:107-147`, `ios/Hooks.swift:74-131`).
7. iOS only: the single core delegate behind `DelegateProxy` (`SV:346-436` and `SD`). WebKit has one delegate slot per kind, and the proxy forwards to one object.

Accreted, with the narrower home: the ask registry (B5-4), Kotlin's file chooser (B5-6), public members and wide constructors (B5-7). Forced by the language, not accreted: the 10 `internal` stored properties that exist for the `+` files (`SV:35,37,61,63,67,69,81,82,86,89`). An extension in another file can't declare stored properties or see `private` ones. The cost is that the Module can reach them too (`SM:55`).
Recommendation: **document**. Add a `docs/decisions.md` section, "The view is the aggregate root" (~12 lines), with the seven items above and the rule: "a feature with state of its own owns it in its own class (Kotlin `requests/`, Navigation, Scripts; Swift Downloads, SharedCookies, DelegateProxy) and takes the view only for props, events and the current WebView; Swift `+Feature` files are one type split by file". S. Confidence medium-high. Breaks: nothing.

**B5-3. An ask made after the view closed never settles, on both platforms. A3's Swift `pendingAsks` leak is otherwise refuted (Q4, Q5).**
While the view is up, every ask is settled: by an answer (`SM:54-56`), a timeout (`SN:77-79`, navigation asks only), a Document end (`SV:98` → `SN:109-111`) or teardown (`SV:257`).
The gap is on iOS. `tearDown` runs once (`SV:253-257`). A hook may keep its context (`SV:65`), and a context holds the view weakly (`ios/Hooks.swift:76`). If the hook calls `ask` while the view object is still alive between `invalidate` and dealloc, the ask is registered (`ios/Hooks.swift:106-108`, `SN:94-98`) and sent to an unmounted component. Then deinit's `tearDown` returns at `guard let webView` (`SV:254`), so `onAnswer` never runs. That breaks `ios/Hooks.swift:61` and `docs/native-hooks.md:70-71` ("its `ask` answers nil"). The same path drops a navigation ask's WebKit `decide` handler uncalled, if a hook retained the WKWebView. That is the exception `SV:256` exists to prevent.
Android has the same gap: after `destroy()` (`KV:409-418`), `HookContext` still holds the view strongly (`KH:107`), and `askWithId` (`KV:308-313`) registers an ask that no later Document end will ever settle. A kept context also keeps the view and its Activity alive.
Recommendation: **simplify**. Put the guard at the top of `register` (`SN:94`), using a `closed` flag set in `tearDown` (`webView == nil` is also true during `configure`), and at the top of `askWithId` (`KV:308`), using `destroyed`. In both cases answer `nil`/`null` at once. 3 to 4 lines per platform. Then make `native-hooks.md:70-71` say it for both platforms. S. Confidence medium: this comes from reading the code, and whether a view object outlives `invalidate` long enough is up to the runtime. Breaks: nothing.

**B5-4. The ask registry accreted on both views. It could be one pure class per platform (Q5, Q3).**
Kotlin: `KV:98-101,303-325,344-345` (29 lines, 7 members). Its users are `K/MinimalWebViewNavigation.kt:69,79`, `Permissions.kt:33,38,48`, `FileUpload.kt:21`, `KH:122` and `KM:145`. Swift: `SV:62-63,67` and `SN:94-111`. Its users are `SD:61`, `ios/Hooks.swift:108`, `SV:98,257,487` and `SM:55`, which writes the dictionary directly.
The narrower dependency is `Asks(send: (Map) -> Unit)` with `ask(…): Int`, `answer`, `cancel(id, tell)` and `end(tell)`, plus B5-3's flag. It is pure on both platforms (no android.webkit, no WebKit), so the ask contract becomes testable with JVM tests and with `swiftc` (`ios/Tests/main.swift` already compiles pure files). Today it is checked on JS's side only (`src/__tests__/WebView.test.tsx`) and on device. Cost: about 30 lines moved per platform, +6 new each. The Kotlin view loses 7 members, the Swift view 2 properties and 3 functions.
Correction to A3 F8: `private(set) var pendingAsks` doesn't compile while its writers stay in `+Navigation.swift` (`SN:96,102`). The minimum without the class is an `answer(_:_:)` next to `cancelAsk` (3 lines), which the module calls.
Recommendation: **split** (the maintainer decides), M. Confidence medium. Breaks: `NC`'s PAYLOADS rows `onHookEvent` (askable) and `core.askCancelled` name `MinimalWebView.kt` and `MinimalWebView+Navigation.swift` (`NC:155-160,197-202,238-243,268-273`); 4 rows move to the new files.

**B5-5. Logic that exists on both platforms: two drifts without a vector, three without one for a reason (Q5, Q3).**
- **Scheme of a bare `about:` or `javascript:`.** Swift's `split` drops the empty half (`ios/NavigationRules.swift:42-43`; checked with swiftc: `about:` → `""`). Kotlin reads it as `about` (`NavigationRules.kt:38`). So with no rules, Swift goes `external` in the main frame (`.swift:48-53`), while Kotlin allows (`.kt:42`). Recommendation: **test**. Add 2 cases to `src/__tests__/vectors/navigation-rules.json` and a 1-line Swift fix (`firstIndex(of: ":")`). S. Confidence high. Impact is low: whether WebKit ever asks the policy for a bare `about:` is unverified.
- **"Is the page on screen the source?"** Kotlin's `showsSource` trims every trailing `/` (`KV:485-490`, pinned by `ShowsSourceTest.kt:17`). Swift's `sameURL` maps only an empty path to `/` (`SN:114-121`; swiftc: `/page` ≠ `/page/`). After a crash or `reload()` with a source the server canonicalizes to `/page/`, Android reloads or re-POSTs the source, while iOS reloads by URL (`SV:199,432`). Recommendation: **test**. Move `sameURL` to `NavigationRules.swift`, which is pure Foundation (2 callers: `SN:13`, `SV:167`), and add a `source-url` vector of about 8 cases that `ShowsSourceTest` and `main.swift` both run. Choose one rule (maintainer). S, ~30 lines. Confidence high.
- **No vector, with the reason:** the crash guard's policy differs on purpose (`docs/decisions.md:63-64`: per view on iOS, per process with same-crash dedup on Android, `KV:497-501`). The shared part is its constants, which A4-16 pins. The ask registry is stateful (B5-4's unit tests instead). `evaluate` and the bridge transport use different platform APIs. `enables()`: JS strips nulls first (`WebView.tsx:432-433`), and the native values come from Expo's bridging, which no vector reproduces. Origin formatting: the 5 inline Swift cases (`ios/Tests/main.swift:70-77`) can move to `origin-rules.json` (S), but Kotlin's `originOf` (`Permissions.kt:57-62`) is built on `android.net.Uri`, which doesn't run on the JVM, so it stays device-only (`example/harness.ts:1958`).

**B5-6. Kotlin's file chooser is spread over the view, the client and the module (Q5).**
The hold lives on the view (`KV:103-105,327-337`). It is used by `ChromeClient` (`KC:244`), by `Listener` (`KC:46`) and by the scope (`KV:132`). The client looks the Module up by registry (`KC:249-250`). Recommendation: **simplify**. Let `FileUpload` own `hold`, `cancel` and the system-chooser fallback; `onShowFileChooser` becomes 4 lines. Net about 0 lines, and the view loses 3 members. S. Confidence medium-high. Breaks: nothing pinned, since `NC`'s FileUpload anchors (`val request = mapOf`, the gate) stay.

**B5-7. Visibility leftovers and two narrowings worth their words (Q5, Q2).**
- Kotlin `clients`, `chromeClients`, `activity`, `emit` and `ask` are public on a public class (`KV:83-85,301,303`), although only in-module code uses them; the sample uses `context.*` only. They are leftovers from when the view itself was the context. Change them to `internal`.
- `document` and `downloads` (`KV:40,89`) have no user outside `KV`: make them `private`.
- Swift `DelegateProxy.core` uses only `responds(to:)` and forwarding (`ios/DelegateProxy.swift:8,21,27`): change it to `NSObject?`.
- Kotlin `PlatformSettings(owner)` uses only `owner.webView` (`K/PlatformSettings.kt:27,95-101`): change it to `PlatformSettings { webView }`. The Swift twin already takes the WebView per call (`ios/PlatformSettings.swift:26`).
- `Listener(this, ::newDocument)` (`KV:154`, `KC:36`) passes the view and its own method; call `owner.newDocument()` as `KC:122` does.

Recommendation: **simplify**. S, about 10 words and −2 lines. Confidence high. Breaks: nothing. Against A3 F5: a narrower `PlatformSettings` does not unblock a test of `coerce` (`PlatformSettings.kt:147`). `coerce` never touches `owner`; it only has to stop being `private`.

**B5-8. Core's features should not be rewritten against the hook seam (Q5, Q1).**
Each feature needs at least one thing `WebViewContext` (`KH:69-101`, `ios/Hooks.swift:50-70`) lacks:
- every feature: the `core.` event name (hooks emit `<key>.x`, and `core` is refused at `KH:50`) and the `requestHandlers` gate (hooks see only `options`);
- Permissions (71 lines): a cancellable ask (`askWithId`/`cancelAsk`, `Permissions.kt:33,38,48`; `ask` returns nothing, `KH:88`);
- FileUpload: the Module's launcher (`KM:41`) and a navigation-start signal (`KC:46`; `Listener` isn't hookable);
- Downloads (174 lines): the core `evaluate` (`Downloads.kt:127`) and the single download-listener slot (`KV:150`, S3);
- Navigation and Scripts: they emit their own Expo events (`onNavigation`, `onBridge`), not `emit`, so they stay Core by definition.

4 of these 6 additions are core-only (the prefix, the gate, the launcher, `evaluate`). They would become a hidden internal half of the context, which is A3 F2's `PageRequestHost` under another name. Two would help consumers: a cancellable `ask` (today a hook can't withdraw an ask when its platform callback is withdrawn, and hook asks have no timeout) and S3/S4 (B1's). Recommendation: **document** this in B5-2's section, and pass the cancellable `ask` (`ask` returns a cancel handle, about 4 lines per platform plus docs) to B1/B2 as an **add-seam** candidate. S. Confidence medium.

**B5-9. `WebView.tsx`: split out the ref store; keep the rest (Q5, Q4).**
Clusters:
- native contract types and constants: `:30-169` (140 lines);
- the ref store: `INITIAL_STATE` to `createWebViewRef` `:171-246`, `useAttach` `:379-400`, `useWebViewState` `:526-533` (106);
- the component: `settle`, `WebView`, `WebViewInstance` with the ask router (`:313-343`) and `useRequestHandlers`, `:248-377,402-409` (136);
- the settings mapper and creation key: `:411-477` (67);
- the load-event machine: `useLoadEvents` `:479-499` (21);
- the statics: `:501-524` (24).

The store is a public feature of its own (`createWebViewRef`, `useWebViewState`, the module-level `adapters`). It shares only `INITIAL_STATE` and the `Attachment` type with the rest, so it can move to its own file and the component reads without it. The contract types and the mapper are what a reader consults while reading the component, so moving them would only move lines. knip gains nothing either way. Recommendation: **split** the store only. S, 533 → about 430. Confidence medium (taste). Breaks: `src/__tests__/WebView.test.tsx:5` and `src/index.ts:1` imports (or a 1-line re-export), and the Stryker `--mutate src/WebView.tsx` command in `docs/development.md`, which gains the new file.

**B5-10. Keep: A3 F2's `PageRequestHost` and A3 F3's `NavigationState` holder (Q5).**
- F2: the request classes are built on android.webkit types (`PermissionRequest`, `GeolocationPermissions.Callback`, `FileChooserParams`, `CustomViewCallback`, `Uri.parse`). The stub android.jar can't instantiate them without Robolectric (`android/build.gradle:23-24`). So a narrower interface buys a shorter signature (+12 lines), not tests. It would also break `NC:63`'s `owner\.requestHandlers` regex.
- F3: the clients are the navigation-state writers by design (`KV:107`, B5-2 item 5). A holder turns `owner.loading` into `owner.state.loading`, removes no jump, and `KC` would still need the view for 13 other members.

Recommendation: **keep**. Confidence medium-high.

## Out of slice
- B4: `TAG`, `RECOVERING`, `webViewCreated` and `failed()` in `KV:470-479` serve 5 files, and `Downloads.failed` shadows the shared `failed` (A3 F12).
- B2/B3: the sample never calls `ask` or `url` (A3 F7). `emit`/`ask` are main-thread-only on iOS (A4-05).
- B3: the Swift crash guard is inline and untested (`SV:423-426`), and its 60 s boundary is `<` where Kotlin's is `<=`.

## Questions only the maintainer can answer
1. B5-4: is a laptop test of the ask contract worth M on both platforms, or are the JS test and the device suites enough?
2. B5-8: should hooks get a cancellable `ask`, i.e. `ask` returning a cancel handle?
3. B5-5: for source detection, should `/page` and `/page/` count as the same page (Kotlin's rule), or only an empty path as `/` (Swift's rule)?
4. B5-1 assumes jest scrapes of native literals are an acceptable pin for values (A3 Q2), as `NC` already does for names. Is that right?

```json
[
{"id":"B5-1","file":"src/__tests__/nativeContract.test.ts","line":60,"quality":5,"claim":"outcome, kind, actions, rule keys, record fields, settings roots, navigate verbs, transport names, permission resources and the per-platform request gates are mirrored by hand and unpinned (gates only as a union); all agree today and each pins in 3-6 lines","recommendation":"test","size":"S","confidence":"high"},
{"id":"B5-2","file":"docs/decisions.md","line":1,"quality":5,"claim":"the view class is an aggregate root by design (Expo surface, WebView life, crash recovery, DocumentScope, navigation state, hook plumbing, iOS core delegate); docs/decisions.md doesn't say so or name its members","recommendation":"document","size":"S","confidence":"medium"},
{"id":"B5-3","file":"ios/MinimalWebView+Navigation.swift","line":94,"quality":4,"claim":"an ask registered after tearDown (iOS) or destroy (Android) by a kept hook context is never settled; deinit's tearDown returns at guard let webView (MinimalWebView.swift:254), contradicting Hooks.swift:61 and native-hooks.md:70-71","recommendation":"simplify","size":"S","confidence":"medium"},
{"id":"B5-4","file":"android/src/main/java/expo/modules/minimalwebview/MinimalWebView.kt","line":98,"quality":5,"claim":"the ask registry accreted on both views (Kotlin 7 members, Swift 2 properties and 3 functions, the Swift module writes pendingAsks); a pure class per platform makes the ask contract laptop-testable; A3 F8's private(set) doesn't compile across files","recommendation":"split","size":"M","confidence":"medium"},
{"id":"B5-5","file":"ios/NavigationRules.swift","line":42,"quality":3,"claim":"two cross-platform drifts have no shared vector: Swift reads 'about:'/'javascript:' with nothing after the colon as scheme '' (Kotlin: about), and source detection treats /page and /page/ as equal on Kotlin only (MinimalWebView+Navigation.swift:114)","recommendation":"test","size":"S","confidence":"high"},
{"id":"B5-6","file":"android/src/main/java/expo/modules/minimalwebview/MinimalWebView.kt","line":327,"quality":5,"claim":"the file chooser hold lives on the view and the client looks up the Module (MinimalWebViewClients.kt:249); FileUpload can own hold, cancel and the fallback","recommendation":"simplify","size":"S","confidence":"medium"},
{"id":"B5-7","file":"android/src/main/java/expo/modules/minimalwebview/MinimalWebView.kt","line":83,"quality":5,"claim":"Kotlin clients/chromeClients/activity/emit/ask are public with in-module users only; document/downloads have no outside user; DelegateProxy.core needs only NSObject; PlatformSettings uses only webView; Listener gets a redundant newDocument parameter","recommendation":"simplify","size":"S","confidence":"high"},
{"id":"B5-8","file":"android/src/main/java/expo/modules/minimalwebview/Hooks.kt","line":69,"quality":5,"claim":"Core's request classes can't be written against WebViewContext without 6 additions, 4 of them core-only (core. prefix, request gate, chooser launcher, evaluate); only a cancellable ask and S3/S4 would serve consumers","recommendation":"document","size":"S","confidence":"medium"},
{"id":"B5-9","file":"src/WebView.tsx","line":171,"quality":4,"claim":"WebView.tsx's ref store (106 lines) shares only INITIAL_STATE and Attachment with the rest and reads better in its own file; the contract types, settings mapper and load events belong with the component","recommendation":"split","size":"S","confidence":"medium"},
{"id":"B5-10","file":"android/src/main/java/expo/modules/minimalwebview/requests/Permissions.kt","line":13,"quality":5,"claim":"A3 F2 PageRequestHost buys no JVM tests (android.webkit types can't be built without Robolectric) and A3 F3's NavigationState holder removes no jump; keep both as they are","recommendation":"keep","size":"S","confidence":"medium"}
]
```
