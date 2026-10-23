# C1 verification: android-view (HEAD 8c0c1ca)

CONFIRMED 7 of 7: B1-4, B2-07, B4-05, B4-15, B5-4, B5-6, B5-7. REFUTED 0. PLAUSIBLE 0.
Two recounts are off by convention only: B5-4's Swift "3 functions" is 4 counted the way Kotlin's 7 is (with `ask`), and B4-15 is right (detekt: 20/11).
Duplicates: B5-7's first clause is B2-07. B4-05's second half is plan section 2's open item (onPageStarted timing). A device run settles it.

Method: read the cited lines at HEAD, grepped every caller in `android/src/main`, `ios/`, `example/modules`, the JVM tests and
`src/__tests__/nativeContract.test.ts`, ran `detekt` (read-only, from a temp dir) and one `swiftc -typecheck` experiment in a
`mktemp -d` dir. No gradle, xcodebuild, Stryker or Periphery.

## B1-4: CONFIRMED (document, S)

- The keys are fixed at the first creation: `MinimalWebView.kt:142` (`hookKeys ?: hookOptions.filterValues(::enables)`), and they are
  reused after a crash. A key that turns on later only warns: `MinimalWebView.kt:292-293`. iOS works the same way: `ios/MinimalWebView.swift:214,453`.
- A hook that was attached keeps getting every later value, including `false` and null (`MinimalWebView.kt:289-291`, `Hooks.kt:136-139`).
  So toggling works only when the key is on at creation and the hook reads the off state from its value (`{ enabled: false }`).
  Strictly, the value doesn't have to stay on after that: the hook can treat `false` as off itself.
- The rule is documented (`docs/native-hooks.md:38-42`, `docs/props.md:14`, `src/types.ts:295-298`). The way to toggle a hook is not:
  `{ enabled }` appears nowhere in docs/, and `example/App.tsx:140` passes `true`. The other way is a new React `key` (a remount).
  The harness itself does that (`example/harness.ts:801-808,2221`), and it isn't documented either.
- Smallest change: one sentence after `docs/native-hooks.md:42`, for example: "To turn a hook on and off, enable its key from the start and put the
  switch in the value (`{ enabled: false }`), or give the WebView a new `key`." Optionally the same clause in the `src/types.ts:295` JSDoc.
- Breaks: nothing (docs only).

## B2-07: CONFIRMED (simplify, S)

- These are public in Kotlin: the class `MinimalWebView.kt:31` and its `clients`/`chromeClients`/`activity` (`:83-85`), `emit` (`:301`) and `ask` (`:303`),
  plus `object NavigationRules` with `Request`/`Decision`/`decide`/`answer` (`NavigationRules.kt:4,5,14,24,35`), and the Records
  `WebViewSource`/`InjectedScript` (`MinimalWebViewModule.kt:204,212`). iOS has the same members internal: `ios/MinimalWebView.swift:4`,
  `ios/NavigationRules.swift:4`, `ios/MinimalWebViewModule.swift:98,106`.
- Every caller is in the module: `Hooks.kt:111-122`, `MinimalWebViewClients.kt:96-236`, `FullscreenVideo.kt:40,83,86`,
  `Downloads.kt:108,141` and `FileUpload.kt:21`. `example/modules/sample-extension/.../SampleExtensionModule.kt:10-12` imports only
  `DocumentScope`, `MinimalWebViewHooks` and `WebViewContext`. The JVM tests (`android/src/test/...`) are in the same Gradle module, so they still see `internal`.
- How emit gets around the core key: `HookContext.emit` prefixes `"$key."` (`Hooks.kt:119`), and `register` refuses `core` (`Hooks.kt:50`).
  Code that casts the view's parent chain to `MinimalWebView` can still call `emit("core.warning", …)`. That needs a deliberate cast, so the risk is low.
- Smallest change: the word `internal` on four declarations: `MinimalWebView.kt:31`, `NavigationRules.kt:4`, `MinimalWebViewModule.kt:204,212`.
  An internal class caps its members, so the five members need no edits. No public signature names these types: every `MinimalWebView`
  parameter is in an internal or private declaration (top-level list from `grep '^class|internal|private'`). Expo builds views and Records by
  reflection (`RecordTypeConverter.kt:80-104` in expo-modules-core), and Kotlin `internal` compiles to public bytecode.
- Breaks: only a consumer's Kotlin that names these types (none in the repo or docs). Nothing else: no tests, vectors or suites.

## B4-05: CONFIRMED (document, S)

- `MinimalWebView.kt:275` says "Only destroy() and recover() detach". The real callers of `detachHooks()` are `processGone` (`:361`) and
  `destroy` (`:414`). `recover()` (`:394-407`) only creates and attaches. The code is still right: `destroy` sets `destroyed` first (`:410`),
  and `processGone` returns when `destroyed` (`:357`). Only the comment names the wrong function.
- `MinimalWebViewClients.kt:115-119` contradicts itself. `:116-117` (a `shortcut:`) says onPageStarted fires at load start, so a load that
  never commits ends the Document. `:118-119` says it fires at commit, so that load gets no events here. `docs/decisions.md:30-31` sides with
  `:116-117`. `docs/props.md:16,67` side with `:118-119`, and `:67` reports a device observation on WebView 133 that fits commit-time: "an
  open file chooser is cancelled only when the next page commits". That file chooser is cancelled only through `newDocument` when there is no
  NavigationListener (`MinimalWebView.kt:132`, `Clients.kt:121-122`).
- Smallest change: `:275` becomes "Only destroy() and processGone() detach". For `:115-119`, delete whichever half is wrong. A run on `mrw-api36`
  settles it: start a download or a 204 from a page with an open ask, then check whether `onLoadStart` fires and the ask is cancelled.
  If commit-time holds, delete `:116-117` and correct `docs/decisions.md:30-31`. This is plan section 2's open item, so it belongs in the D packet.
- Breaks: nothing (comments). The `ponytail-debt` ledger loses one `shortcut:` if `:116-117` goes.

## B4-15: CONFIRMED (keep, S)

- detekt at HEAD: "Class 'MinimalWebView' with '20' functions detected … threshold … '11'" (`MinimalWebView.kt:31:7`).
  `TooManyFunctions` reports at count >= threshold: the same run reports `CognitiveComplexMethod - 15/15` (`PlatformSettings.kt:35`).
  So 20 functions need 21. Without the two file-chooser functions (`:328`, `:337`) the count is 18, which needs 19. The finding's numbers hold.
- Recounted callers of the 20 non-private, non-override functions: 12 classes. They are MinimalWebViewModule, PullToRefresh, MinimalWebViewScripts,
  HookContext, Downloads, FullscreenVideo, FileUpload, MinimalWebViewNavigation, Permissions, Listener, Client and ChromeClient. PlatformSettings
  reads only the `webView` property. (`Navigation.kt:33,156` `destroy` is a child WebView's, not the view's.)
- Smallest change: `@Suppress("TooManyFunctions")` with a one-line reason on `MinimalWebView.kt:31`, not `thresholdInClasses: 21` in
  `detekt.yml:10`. Both are one line, but the global value would let every other class grow to 20. Either way it is the D packet's
  aggregate-root and threshold decision. If B5-6 and B5-4 land, the count is 14 (`ask`, `askWithId`, `answer`, `cancelAsk` leave), which needs 15.
- Breaks: nothing.

## B5-4: CONFIRMED with a recount (split, M)

- Kotlin has 7 members: `pendingAsks` and `nextAskId` (`MinimalWebView.kt:100-101`), plus `ask`, `askWithId`, `answer`, `cancelAsk` and
  `failAsks` (`:303,308,316,321,345`).
- Swift has 2 properties (`ios/MinimalWebView.swift:63,67`) and 4 functions counted like Kotlin's 7: `register`, `cancelAsk` and
  `failPendingAsks` (`MinimalWebView+Navigation.swift:94,101,109`), plus `ask` (`MinimalWebView.swift:486`). The finding's 3 leaves out `ask`.
- The module mutates the dictionary itself: `ios/MinimalWebViewModule.swift:55` (`view.pendingAsks.removeValue`).
- `private(set)` doesn't compile across files. An experiment with a class in a.swift and an extension plus a module-style caller in b.swift fails:
  "cannot assign through subscript: 'pendingAsks' setter is inaccessible". `+Navigation.swift:95-96` and `Module.swift:55` write from other files.
- No laptop test covers the contract (answer once, a late answer dropped, cancel → null, `tell` at closing). The JVM tests use only junit and
  org.json (`android/build.gradle:23-24`). The view is an Android View, and `NavigationRulesTest` covers only the `ask` gate in `decide`.
  `ios/Tests/main.swift` compiles only the rules and DocumentScope (`docs/development.md:11`).
- Smallest change: the split does the whole job, including testability. Each platform gets a pure `Asks` class (`register`, `answer`,
  `cancel(tell)`, `failAll(tell)`) that takes a `send` callback for `core.askCancelled`, at about 25 lines per platform plus tests.
  `DocumentScope` (PR #34) set the pattern. A smaller step, S, fixes only the encapsulation: add a Swift `answer(_:_:)` like Kotlin's
  `:316`, call it from `Module.swift:55`, and move the three functions into `MinimalWebView.swift` so the properties can be `private`.
  That step adds no test.
- Breaks (split): the callers. Kotlin: `Navigation.kt:69,79`, `Permissions.kt:33,38,48`, `FileUpload.kt:21`, `Hooks.kt:122`,
  `Module.kt:145` and `MinimalWebView.kt:136,323`. Swift: `MinimalWebView.swift:98,487`, `+Navigation.swift:68,78` and `Module.swift:55`.
  New files go top-level in `android/.../minimalwebview/` and `ios/`, because `nativeContract.test.ts:28-33` reads only those directories
  for `"core.askCancelled"` and the `core.*` names. The Swift file goes on the swiftc line in `docs/development.md:11`
  (`.github/workflows/test.yml:34` goes stale: CI is off-limits). The suites that use asks are navigation, upload, permissions and sampleExtension.

## B5-6: CONFIRMED (simplify, S)

- The hold lives on the view: `fileChooser` (`MinimalWebView.kt:105`), `holdFileChooser`/`cancelFileChooser` (`:328-337`), and the Document reset
  (`:132`). The client wraps the callback (`Clients.kt:244`), branches to the hook (`:245-247`) and the prop (`:248`), then looks up the Module
  for the system chooser (`:249-250`). `FileUpload.kt:14-26` owns only the prop branch.
- Smallest change: move the field, the hold, the cancel and the `:249-250` fallback into `FileUpload`, then point
  `Clients.kt:46,244,248` and `MinimalWebView.kt:132` at `fileUpload`. `ExpoView.appContext` is public and `openFileChooser` is internal
  (`Module.kt:41`), so the `requests` package reaches both. The hold must stay before the hook branch: a hook's chooser is held too.
  The view loses 2 functions (see B4-15).
- Breaks: nothing public. No JVM test touches the code. The `nativeContract.test.ts:63-66` regex
  (`"fileRequest" !in owner.requestHandlers`) stays in FileUpload. On device, the `upload` suite covers it (`example/harness.ts:681-780`).

## B5-7: CONFIRMED (simplify, S)

- (a) The five public members: the same evidence as B2-07. The `internal class` there covers them.
- (b) `document` (`MinimalWebView.kt:40`) and `downloads` (`:89`) are `internal`, but every use is in `MinimalWebView.kt` (`:132-138,340,360,413`;
  `:152,415`), so both can be `private`. On iOS `document` (`MinimalWebView.swift:64`) is used only in that file. `downloads` must stay: `+Navigation.swift:21` uses it.
- (c) `DelegateProxy.core` (`ios/DelegateProxy.swift:8,12`) is used only for `responds(to:)` and as a forwarding target (`:21,27`), so `NSObject?` is enough.
- (d) Kotlin `PlatformSettings` uses its owner only as `owner.webView`, 5 times (`PlatformSettings.kt:95-101`). The property is lazy and replaced
  after a crash (`MinimalWebView.kt:49-53,398`), so the narrow form is `PlatformSettings { webView }` taking `() -> WebView`, not a WebView.
  iOS already passes the webView per call (`ios/PlatformSettings.swift:25`).
- (e) The `Listener` constructor's `newDocument` parameter (`Clients.kt:36`), passed at `MinimalWebView.kt:154`, duplicates `owner.newDocument()`,
  which is internal (`:340`) and which `Client` calls directly (`Clients.kt:122`). No test builds a `Listener` (`MinimalWebViewClientsTest.kt:15-20`).
- Smallest change: B2-07's `internal`, plus `private` on `:40`/`:89`, `NSObject` in DelegateProxy, a lambda for PlatformSettings, and
  `owner.newDocument()` at `Clients.kt:61` with `Listener(this)`. About 10 lines. (d) only narrows a type and is the one item worth skipping.
- Breaks: nothing in the repo (no tests, vectors, suites or docs). For consumers, the same as B2-07.

```json
[
 {"id": "B1-4", "verdict": "CONFIRMED", "evidence": "MinimalWebView.kt:142 fixes hookKeys at first creation (reused after a crash); :292-293 only warns for a key turned on later; iOS MinimalWebView.swift:214,453 the same; an attached hook gets every later value incl. false/null (MinimalWebView.kt:289-291). docs/native-hooks.md:38-42, props.md:14 and types.ts:295-298 state the rule, but nothing documents how to toggle (`{ enabled }`, or a new React key, the way harness.ts:801-808 does it).", "smallest_change": "One sentence after docs/native-hooks.md:42: enable the key from the start and put the switch in the value ({ enabled: false }), or give the WebView a new key.", "size": "S", "breaks": "nothing (docs)"},
 {"id": "B2-07", "verdict": "CONFIRMED", "evidence": "Public in Kotlin: MinimalWebView.kt:31 (+ :83-85, :301, :303), NavigationRules.kt:4, MinimalWebViewModule.kt:204,212. The iOS counterparts are internal (MinimalWebView.swift:4, NavigationRules.swift:4, MinimalWebViewModule.swift:98,106). Every caller is in the module; the sample extension imports only DocumentScope, MinimalWebViewHooks and WebViewContext. HookContext.emit prefixes the key (Hooks.kt:119), but a cast to MinimalWebView could emit core.*.", "smallest_change": "`internal` on four declarations: MinimalWebView.kt:31, NavigationRules.kt:4, MinimalWebViewModule.kt:204,212 (the class's members follow).", "size": "S", "breaks": "Only consumer Kotlin that names these types (none in the repo or docs). Same-module JVM tests unaffected. Expo uses reflection, and internal is public bytecode."},
 {"id": "B4-05", "verdict": "CONFIRMED", "evidence": "detachHooks() is called from processGone (:361) and destroy (:414), never from recover (:394-407); the code is right because :357 and :410 guard it. Clients.kt:116-117 (load start) vs :118-119 (at commit) contradict each other: decisions.md:30-31 sides with the first, props.md:16,67 with the second, and props.md:67's WebView 133 observation (file chooser cancelled only at the next commit) fits commit-time.", "smallest_change": ":275 -> 'Only destroy() and processGone() detach'. For :115-119, delete the wrong half once a WebView 133 run settles it (an ask open, then a download or a 204: does onLoadStart fire and the ask cancel?). If commit-time holds, also delete :116-117 and correct decisions.md:30-31. This is the plan's open item (D packet).", "size": "S", "breaks": "nothing (comments; one shortcut: entry leaves the ledger)"},
 {"id": "B4-15", "verdict": "CONFIRMED", "evidence": "detekt at HEAD: TooManyFunctions 20/11 at MinimalWebView.kt:31:7. detekt reports at >= threshold (CognitiveComplexMethod 15/15 is reported), so 20 needs 21, and 18 (without :328 and :337) needs 19. Recount: 12 caller classes (Module, PullToRefresh, Scripts, HookContext, Downloads, FullscreenVideo, FileUpload, Navigation, Permissions, Listener, Client, ChromeClient).", "smallest_change": "@Suppress(\"TooManyFunctions\") with its reason on MinimalWebView.kt:31, rather than a global thresholdInClasses: 21 that also loosens every other class. Maintainer's D-packet threshold decision. With B5-4 and B5-6 the count is 14, needing 15.", "size": "S", "breaks": "nothing"},
 {"id": "B5-4", "verdict": "CONFIRMED", "evidence": "Kotlin has 7 members (MinimalWebView.kt:100-101,303,308,316,321,345). Swift has 2 properties (MinimalWebView.swift:63,67) and 4 functions counted the same way (+Navigation.swift:94,101,109 plus MinimalWebView.swift:486); the finding's 3 leaves out ask. MinimalWebViewModule.swift:55 mutates pendingAsks. A swiftc experiment shows private(set) fails across files ('setter is inaccessible'). No laptop test covers the ask contract (junit and org.json only, android/build.gradle:23-24; main.swift compiles only the rules and DocumentScope).", "smallest_change": "As recommended, for testability: a pure Asks class per platform (register/answer/cancel(tell)/failAll(tell) plus a send callback), about 25 lines each plus tests, following DocumentScope. Encapsulation only (S, no test): a Swift answer() called from Module.swift:55, with the three functions moved into MinimalWebView.swift so the properties can be private.", "size": "M", "breaks": "Callers: Kotlin Navigation.kt:69,79, Permissions.kt:33,38,48, FileUpload.kt:21, Hooks.kt:122, Module.kt:145, MinimalWebView.kt:136,323; Swift MinimalWebView.swift:98,487, +Navigation.swift:68,78, Module.swift:55. New files go top-level (nativeContract.test.ts:28-33 reads only those dirs). The swiftc line in development.md:11 needs the new file (test.yml:34 goes stale). Suites: navigation, upload, permissions, sampleExtension."},
 {"id": "B5-6", "verdict": "CONFIRMED", "evidence": "The hold lives on the view: MinimalWebView.kt:105,132,328-337. Clients.kt:244-250 wraps the callback, branches to the hook and the prop, then looks up the Module for the system chooser. FileUpload.kt:14-26 owns only the prop branch.", "smallest_change": "Move the field, hold, cancel and the Clients.kt:249-250 fallback into FileUpload, and point Clients.kt:46,244,248 and MinimalWebView.kt:132 at fileUpload. Keep the hold before the hook branch.", "size": "S", "breaks": "Nothing public. No JVM test touches it. The nativeContract.test.ts:63-66 gate regex stays in FileUpload. On device: the upload suite (harness.ts:681-780)."},
 {"id": "B5-7", "verdict": "CONFIRMED", "evidence": "(a) as B2-07. (b) document (:40) and downloads (:89) are used only in MinimalWebView.kt; iOS document (MinimalWebView.swift:64) only in that file. (c) DelegateProxy.swift:8,12 uses core only for responds(to:) and forwarding (:21,27). (d) PlatformSettings.kt:95-101 uses only owner.webView (5x), which is lazy and replaced at :398. (e) Listener's newDocument parameter (Clients.kt:36, passed at MinimalWebView.kt:154) duplicates owner.newDocument() (internal, :340, called directly at Clients.kt:122); no test builds a Listener.", "smallest_change": "B2-07's internal; private on MinimalWebView.kt:40,89; NSObject? in DelegateProxy.swift:8,12; PlatformSettings { webView } taking () -> WebView; owner.newDocument() at Clients.kt:61 with Listener(this). About 10 lines; (d) is optional.", "size": "S", "breaks": "nothing in the repo (tests, vectors, suites, docs); for consumers as B2-07"}
]
```
