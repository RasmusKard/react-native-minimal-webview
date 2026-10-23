# Quality review synthesis: minimal-rn-webview @ 12d6e71 (2026-10-23)

Inputs: A1 to A5, B1 to B5 (66 findings) and seven C1 verifiers, all in this directory. C1: 57 CONFIRMED, 6 PLAUSIBLE,
3 REFUTED (B1 5/2/1, B2 15/2/0, B3 11/0/2, B4 16/2/0, B5 10/0/0); where C1 differs from a B report, C1's verdict, size
and smallest change win. Nothing ran on a device. Ids: `S-nn` do now, `Dn` decide, `Xn` not doing; "seam S5" = plan §2.

## Verdicts

1. **Minimal core: pass with items** (the items are decisions: D1, D2, D6). Core is 5,552 physical lines (cloc: Kotlin
   1,710, Swift 1,176, TS 920), +674 since 806d16f, 64% of it in Hooks, Bridge, Crash recovery and Navigation; the
   movable rows grew 11 (A2). All 20 rows have a reason (9 platform default wrong, 4 the seam, 5 cheaper in the library,
   plus plumbing), none lapsed after PR #36 (B1-1), and no deferred move shrinks Core as the glossary defines it (B1-2).
2. **Good interfaces: pass with items.** 10 of 10 error codes lowercase, 3 of 3 discriminants, 8 of 11 callbacks follow
   `…Request`/`…Event` (not `HookEvent`, `Download | DownloadFailure`, `onOpenExternal`), 8 of 9 platform-only items
   marked (not `didCrash`); hook contexts share 7 members (Swift 9, Kotlin 10). Two interface bugs (S-01, S-04), one
   silent setup error (S-05), A4's 15 drift items all confirmed. Sketches: 6 of 10 fully, 2 with app config, 2 partial.
3. **Easily maintainable: fail, narrowly** (2 of 5 tests; every fix S or M). Laptop-tested native code: Kotlin 82 of
   1,710 lines, Swift 108 of 1,176; 1 of 4 risky paths, on one platform (A5, B3). The `--check`s run only in dead CI.
   detekt 9, SwiftLint 5, Periphery 2, ESLint 26 warnings, none ratcheted. `WebView.tsx` Stryker 65.8% (91 of 115
   survivors untested; 389:19 is killable, C1 probe). 4 stale doc claims, 3 rules only in comments (B3-06, B3-07).
4. **Easy to reason about: pass with items.** 6 traces, 43 steps, 7 with more than one jump; of 38 invariants, 25 are
   written at the site, 5 elsewhere, 6 nowhere, 2 contradicted (B4). Walking found 4 bugs, all S and confirmed. Of 15
   complexity findings 13 clear with local S changes (C1 measured: `definition` 57 lines/8/10, `fetch` cognitive 6,
   `apply` 14/11, Kotlin `coerce` 12 with one config key); the two view classes are a threshold decision (D5).
5. **Decoupled: pass with items.** The view is an aggregate root by design: Kotlin 36 functions, 29 by design, 7
   accreted (ask registry 5, file chooser 2); on Swift the ask registry accreted (B5-2, B5-4). Fan-in: 12 Kotlin
   classes, 4 Swift holders. 30 cross-layer mirrors: 5 pinned, 8 partly, 17 not (A3; rule keys and actions are pinned
   by the vectors, C1). 7 cross-platform pairs: 2 with vectors, 2 drifting without, 3 with a reason (B5-5). TS acyclic.

## Corrections to the plan, and caveats to carry

- Plan §2 "Open ... not claimed in user docs" is wrong: `docs/props.md:16` and `:67` claim it (A4-03, B2-09, C1-docs).
- Plan §3: `OriginRules.swift:27` is a 4-tuple, not 3 (C1-ios-rest); ESLint is 0 errors with 26 warnings (A1); Swift
  `coerce` is hidden by `ignores_case_statements` (SwiftLint 19 with cases counted, lizard 24); detekt flags a value
  equal to its threshold, SwiftLint and sonarjs don't (A1-09).
- B2-08's verification was not fully independent: a grep showed the verifier B2-08's and A4's text; it then checked
  each of the seven points against the code. B2-10's "A4's 40-line test holds" was not re-checked.
- B5 refuted A3's Swift `pendingAsks` leak; the ask-after-close gap remains on both platforms (S-03). A2's starred rows
  (BFC, NS, PS, Other, Glue, DS) have low-confidence deltas. Not verified by anyone: the iOS crash reload skipping the
  shared-cookie copy (`MinimalWebView.swift:432`, B1 out of slice).

## Cross-confirmed (reached independently)

| Item | Sources | Goes to |
|---|---|---|
| Android `ref.hook` rejects `hook_not_handled` while the WebView is rebuilt; docs promise `unavailable` | A4-02, B2-01, B4-02a, C1-ts-and-tooling (found while checking B2-08) | S-01 |
| A hook's `ask` made after close is never answered, both platforms | B2-04c, B4-04, B5-3; C1 widened B2's Android-only claim | S-03 |
| Pre-146 Document end: `decisions.md` and one comment say load start, user docs and the next comment say commit | A4-03, B2-09, B3-06, B4-05b; C1-docs, C1-android-view | D3 |
| Crash-guard reset documented as "source or reload()" for both; Android resets on `reload()` only | A4-01, B2-06, B3-07c | S-20 |
| iOS `emit`/`ask` don't hop to main; Kotlin does | A4-05, B2-02 | S-04 |
| Kotlin view, rules and Records public; iOS internal | B2-07, B5-7a, B1 out of slice | S-06 |
| Swift ask registry over three files; the module writes `pendingAsks` | A3 F8, B4-06, B5-4 | S-13, D4 |
| Recovery twins drift: 60 s boundary, trailing slash | A3 F6, B3-08, B5-5b | D9 |
| Swift reads a bare `X:` as scheme `""`, Kotlin as `X` | B2 out of slice, B5-5a (C1: any bare scheme) | S-13 |
| Cross-layer values unpinned | A3 F1, A4-16, B2-10, B5-1 | S-16 |
| `Downloads.fetch` complex and untested | A1-02, A2-6, B3-04, B4-10, B1-7 | S-09, D6 |
| `PlatformSettings.coerce` complex, untested, hidden on Swift | A1-01, B3-03, B4-09 (B3-09 refuted) | S-10, D5, D11 |
| Sample extension ignores its own doc | A3 F7, A4-15, B2-15 | S-19 |
| Tool findings A1 measured and B judged the same way: module `definition`s, `matches`' 6 parameters, Periphery's unused `webView`s, the one `.mjs` | A1-03/B4-08, A1-05/B4-12, A1-06/B3-02, A1-08/B3-13 | S-08, S-11, S-13, S-18 |
| File chooser state on the view | A3 F9, B5-6, B4 (grouping) | S-12 |
| A hand-made `Bridge` type-checks and injects nothing | A4-14, B2-13 | S-14 |
| `uiDelegates`, `chromeClients`, `activity` in no doc | A4-04, B2-05 | S-20, D7 |
| View class is the aggregate root | A1-04, A3, B4-15, B5-2 | D4, D5 |
| Bridge glue in `WebView.tsx` untested | A5, B3-05 | S-15 |

## Disagreements

1. Kotlin's detach reason and `context.activity`: keep and document (A4-04, A4-06, C1-docs) or delete (B2-04,
   C1-hooks-clients; the reason always equals the `onDocumentEnd` just before it). **Maintainer** (D7; delete both).
2. View function count: `thresholdInClasses: 21` (B4-15) or `@Suppress` with a reason (C1-android-view). D5.
3. Swift view: same-file extension move plus `file_length` warning 490 (B4-13); C1: the move makes the file 491 and
   leaves 3 lines of body margin, so config only, or move plus warning 500. D5.
4. Ask registry: a Swift `answer()` (B4-06, S) or a pure `Asks` class per platform (B5-4, M). D4.
5. ESLint at zero with `no-void` off (B3-02) or `--max-warnings 26` (C1-docs); baselines (B3-02) or every tool at zero
   (B3 question 1). D5: zero, no baselines.
6. B1-2 keeps sharedCookies in Core while B1-3 names it seam S5's first user (C1-ios-view). Resolved: B1-3 refuted;
   seam S5 needs a third-party use of its own (D2). "`context.core` subsumes S4" (B1-6) holds for one delegate (D2).
7. A3 F2/F3 narrow interfaces vs B5-10 keep: keep; C1 corrects the reason (X6).

Checked against plan §2: nothing here re-opens a keep or a rejection. D4(b) is not review candidate 2 (the policy stays
in Navigation; only the id-to-callback store moves); D6 keeps downloads in the package; D8 only extends MRWInvoke.

## S: do now (confirmed, size S, no decision needed)

K = `android/src/main/java/expo/modules/minimalwebview/`. NC = `src/__tests__/nativeContract.test.ts`.

| Id | Change | Files | Breaks | Sources |
|---|---|---|---|---|
| S-01 | Recovery window: `hook` rejects `unavailable` while `recovering`; warn at `:292` only if `key !in hookKeys`; `navigate` returns early while recovering (not `reload`); one line at `webView`'s declaration (:45-49) saying it is dead then | K/MinimalWebViewModule.kt:125-150, K/MinimalWebView.kt:45-49, :292 | `hook`'s code in that window (as documented); no test covers it | B2-01, A4-02, B4-02a-c |
| S-02 | Download event: `owner.mainHandler.post` for `owner.webView.post` (lost after a crash, read on IO) | K/requests/Downloads.kt:106 | nothing | B4-01 |
| S-03 | Hook ask after close answers null: Kotlin `if (destroyed) return onAnswer(null)`; Swift `private var closed` set in `tearDown`, guarded in `ask` (not `webView == nil`: also nil during `configure`); `native-hooks.md:70-71` for both | K/MinimalWebView.kt:303-305, ios/MinimalWebView.swift:253-270, 486-488 | nothing tested | B4-04, B5-3, B2-04c |
| S-04 | iOS `HookContext.emit`/`ask` hop to main as Kotlin's do (~4 lines); `native-hooks.md:69`: "callable from any thread; callbacks run on main" | ios/Hooks.swift:102-109 | an off-main ask's answer becomes async | B2-02, A4-05 |
| S-05 | Warn `core.warning` for an enabling `hookOptions` key no hook is registered under: Swift after :214 (3 lines), Kotlin at first creation only (`hookKeys == null`, 2 lines); `native-hooks.md:41-42` | ios/MinimalWebView.swift:214, K/MinimalWebView.kt:142 | a platform-only hook passed on both platforms warns on the other | B2-03 |
| S-06 | Visibility: `internal` on the view class, `NavigationRules`, the two Records; `private` `document`, `downloads`; Swift `DelegateProxy.core: NSObject?`; `Listener(this)` calling `owner.newDocument()` | K/MinimalWebView.kt:31, 40, 89, 154; K/NavigationRules.kt:4; K/MinimalWebViewModule.kt:204, 212; K/MinimalWebViewClients.kt:36, 61; ios/DelegateProxy.swift:8, 12 | consumer Kotlin that names these types (none in repo or docs) | B2-07, B5-7a,b,c,e |
| S-07 | `overrides` sees a plain client's deprecated variants: key `COMPAT_VARIANTS` by declaring class, 4 entries, one HooksTest case; `native-hooks.md:50-51` | K/Hooks.kt:157-180, android/src/test/.../HooksTest.kt | a hook's deprecated override now takes that decision | B2-11 |
| S-08 | Module `definition`s: Kotlin `navigate`, `hook`, `warmUp` bodies to private functions (57 lines, 8, 10); Swift the `hook` body only (~53) | K/MinimalWebViewModule.kt:57-156, ios/MinimalWebViewModule.swift:5-69 | nothing; NC:35 still finds the names | B4-08, A1-03 |
| S-09 | `copyCapped(input, output, max)` in the companion (fetch cognitive 23 to 6) and a JVM test of the streamed cap with `ByteArrayInputStream` | K/requests/Downloads.kt:53-76 + one test | keep the `"core.download",` call sites (NC:168-171) | B4-10, B3-04 (part), A1-02 |
| S-10 | `apply`: `targets(rootName)?.takeIf { rootName in listOf("settings", "webView") }` (14/11); move `set`, `arguments`, `coerce`, `invoke`, `problem` into the companion, `Target` internal; ~40-line JVM test with a fake class | K/PlatformSettings.kt:32-170 + one test | nothing | B4-11, B3-03 |
| S-11 | `Parts(scheme, host, path, params)` (Kotlin data class for the `Triple`, Swift private struct); `matches(rule, parts, request)` | K/NavigationRules.kt:62, 81; ios/NavigationRules.swift:57-79 | nothing (private; vectors unchanged) | B4-12, A1-05 |
| S-12 | `FileUpload` owns the held chooser, its cancel and the system-chooser fallback; the hold stays before the hook branch | K/MinimalWebView.kt:105, 132, 328-337; K/MinimalWebViewClients.kt:46, 244-250; K/requests/FileUpload.kt | nothing public; `upload` suite on device | B5-6, A3 F9 |
| S-13 | Swift: `OriginRules` `private struct Parsed` (53/53 pass); delete the unused `webView` parameters; `answer(_:_:)` beside `register`, the module calls it (skip if D4(b)); scheme via `firstIndex(of: ":")` (79/79) plus 3 vector cases (`about:` main frame, `about:` new window, `myapp:` scheme rule) | ios/OriginRules.swift:27; ios/MinimalWebView+Navigation.swift:7, 94; ios/MinimalWebView.swift:353, 400-412; ios/MinimalWebViewModule.swift:55; ios/NavigationRules.swift:42-43; src/__tests__/vectors/navigation-rules.json | iOS decisions for bare-scheme URLs now match Kotlin | B4-14, A1-06, B4-06, B5-5a |
| S-14 | `Bridge` gets `readonly [CONNECTION]: BridgeConnection` (type import); `WebView.tsx` drops the cast (C1 ran tsc and jest on it) | src/types.ts:139-164, src/WebView.tsx:294-295 | a hand-made or mock `Bridge` no longer compiles; `BridgeConnection` in the d.ts | B2-13, A4-14 |
| S-15 | `WebView.test.tsx`: `bridgePost` in the mock, one `describe('bridge')` (glue, origin, `navigated`/`unavailable`, detach, creation-key identity), a `ref={null}` render (~35 lines); delete dead `WebView.tsx:467` | src/__tests__/WebView.test.tsx, src/WebView.tsx:467 | nothing | B3-05, A5 |
| S-16 | NC pins: `Record<Union, 1>` presence per platform for `outcome`, `kind`, Record fields, settings roots, `navigate` verbs, transport names, permission resources (~15); per-platform request gates (~4); vector rule keys vs `keyof NavigationRule` (3); error codes (~6); hook context members (~8). Not the prose numbers | NC | regexes break on a native restructure | B5-1, B2-10, A3 F1, A4-16 |
| S-17 | Ref store to `src/refStore.ts` (`WebView.tsx:171-246, 379-400, 526-533`, 533 to ~430 lines). Taste (B5, medium): skip freely | src/WebView.tsx, src/index.ts:1, WebView.test.tsx:5 | imports; Stryker `--mutate` command gains the file | B5-9, A3 F11 |
| S-18 | `pretest` runs both `--check`s (0.3 s) and a `check` script runs the laptop set; `development.md:3-13, :26` name them. `build-page-client.mjs` to `.mts` with `compile(file: string)`, Prettier, `'**/*.mts'` in `eslint.config.cjs`; regenerate the page client's header | package.json:26-35, .github/scripts/build-page-client.*, eslint.config.cjs, docs/development.md, src/bridge/pageClient.generated.ts:1, endpoint.ts:3, pageClient.ts:2 | `npm test` fails on a stale generated file; `test.yml:22` goes stale (off-limits); `gen-platform-types.mts` gets linted (unknown warnings) | B3-01, B3-13, A1-08 |
| S-19 | Sample extension: keys prefixed `sample.`, iOS filters `.closing`, Kotlin `configure`, one `context.ask` and `context.url` use; emit `context.url` from `onDocumentEnd` (settles D13) | example/modules/sample-extension/{ios,android,src}, example/harness.ts:2175-2233, example/App.tsx | harness key strings, `sampleExtension` suite, a native rebuild | B2-15, A4-15, A3 F7 |
| S-20 | User docs: crash-guard reset per platform, and rename the check at `harness.ts:1193` (it runs after `reload()`); history kept unless the source page is on screen or the reload was held; `didCrash` always true on iOS; rebuild waits for background or detached; hook-decided navigations aren't reported; `hook` in the ref list; `RangeError` and `__receive`; an equal `source` doesn't load; number types per path; the four hook lists; the `{ enabled }` toggle or a new `key`; iOS `didBecome` hand-off while `onDownload` is set; a handler that never replies leaves `ref.hook` pending; glossary exceptions `HookEvent` and `Download`; https-to-http download redirects refused; one file chooser per app | docs/props.md:5, 18, 23-25; glossary.md:29, 36, 48-49; CHANGELOG.md:11, 45; types.ts:14-23, 98, 148-150, 256-257; navigation-rules.md:37; migrating:211; bridge.md:39, 68; native-hooks.md:42-62; page-requests.md:9, 37; security.md | nothing | B2-05, B2-06, B2-08, B2-14, B3-07, B4-18, B1-4, B1-8, B4-03 (doc), A4-01, 04, 07-10, 12, 13 |
| S-21 | Dev docs and comments: `showsSource` in `development.md:10`; AVD create lines (`android-37.1;google_apis_ps16k`, `android-36;google_apis`, `pixel_9_pro`) and "API 37.1, 16 KB pages" at :83; a sample-extension compile line (confirm the task with `./gradlew projects`); detekt flags at equality. Comments: `MinimalWebView.kt:275` "Only destroy() and processGone() detach"; `MinimalWebViewNavigation.kt:84` (`loadUrl` skips `shouldOverrideUrlLoading`); `MinimalWebView+Navigation.swift:58` (WebKit has no redirect flag) | docs/development.md; the three comment sites | nothing | B3-10, B4-05a, B4-16, A1-09 |

**Suggested waves** (plan §7: two or three items, no shared native file; device runs for any native or `WebView.tsx` change):

| Wave | Items | Native files |
|---|---|---|
| W1 | S-01, S-02, S-04 | MinimalWebViewModule.kt + MinimalWebView.kt / Downloads.kt / Hooks.swift. D3's mrw-api36 probe can ride on this run |
| W2 | S-03, S-07, S-14 | MinimalWebView.kt + .swift / Hooks.kt + HooksTest / none |
| W3 | S-05, S-08, S-15 | MinimalWebView.swift + .kt / both module files / none |
| W4 | S-06, S-13, S-18 | MinimalWebView.kt, NavigationRules.kt, Module.kt, Clients.kt, DelegateProxy.swift / OriginRules, NavigationRules, MinimalWebView, +Navigation, Module (all .swift) / none. Periphery reaches 0: add `--strict` |
| W5 | S-10, S-11, S-12 | PlatformSettings.kt / NavigationRules.kt + .swift / MinimalWebView.kt, Clients.kt, FileUpload.kt. D5's `coerce` rewrite and `ignoreSimpleWhenEntries` join S-10; D5's SwiftLint disables land here (SwiftLint reaches 0) |
| W6 | S-09, S-17, S-20 | Downloads.kt / none / none. D5's `@Suppress` lands here (detekt reaches 0) |
| W7 | S-16, S-19, S-21 | none / the sample (example rebuild; its device run settles D13) / comments only. S-16 last: it pins what earlier waves and D7 settle |

## D: decisions for the maintainer

**D1. The three deferred moves** (B1-2 confirmed, B1-5 plausible). Consumer cost with an in-package move: none (the
prop stays). As a recipe each consumer writes an Expo module (~70 lines of config and skeleton, B1's yardstick).

| Move | Leaves view/request files | Seams it needs | Net package | Recipe per consumer | Breaks |
|---|---|---|---|---|---|
| sharedCookies (iOS) | 18 lines | seam S5, per load (D2) | +6 (+18 with an Android twin) | ~90 + rebuild, still wrong on the first load | `sharedCookies` becomes a taken hook key; the crash reload (`MinimalWebView.swift:432`) skips the gate |
| pull-to-refresh | Android `PullToRefresh.kt` 76 + 7 touch lines, iOS 12 | S2 ~10, S6 ~6, a load-end observation ~8 (B1-5: a hook may add its own NavigationListener; one device check with a second listener settles it) | +32 to +38 | ~195 + rebuild | the WebView leaves the always-present SwipeRefreshLayout; the vh=0 fix moves |
| download saving | 210 (`Downloads.kt` 174, `Downloads.swift` 36) | S3 ~8, S4 ~10 or `context.core` ~4 | +32 to +38 | ~295 + rebuild, against "don't touch the download listener" | `core.download` renamed (pinned in NC); claim order vs app hooks; the blob read loses the core `evaluate`'s checks |

Recommendation: keep all three in Core and close the 2026-10-22 deferral for them. If "small core" means the view and
module classes rather than the package (question 1), only download saving moves more than 100 lines.

**D2. Seams S2 to S6, `holdLoads`, `context.core`, a cancellable hook ask.** Without a seam the third-party feature is
impossible or costs taking the whole decision; with it, the author writes feature code in the module they already have.

| Seam | Lines | Unblocks | Breaks | Recommendation |
|---|---|---|---|---|
| S2 Android content wrapper | ~10 | native UI around the WebView; no sketch needs it | nothing | don't add |
| S3 Android download listeners | ~8 | an extension that saves or tracks downloads (impossible today, `native-hooks.md:72-73`) | nothing | only for a named use |
| S4 iOS response-policy split | ~10 | every hook sees responses without losing `http` errors and the download default | nothing | only for a named use; `context.core` covers one hook delegate only |
| S5 before-load gate (absorbs `holdLoads`) | per-load `context.beforeLoad { done in }`, routing the core's `cookies.prepare`: iOS ~14 (M), Android twin ~12 | async setup before every `source` load (content-rule lists, sketch 9) | a new requirement on public `WebViewContext`; a `done` never called stalls props (needs a timeout); iOS-only API without the twin; no laptop test | only for a named use, both platforms; a one-shot `holdLoads` doesn't fit cookies |
| S6 `context.reload()` | ~6 | a hook reload with the core's POST and failed-URL rules | nothing | don't add (`ref.reload()` exists) |
| `context.core` | iOS ~3-4; Android a ThreadLocal bypass ~8 plus a special case for `onShowFileChooser` (S-M) | decline a decision, let the core decide | a public context member; `native-hooks.md:43-48` | both platforms or neither, for a named use |
| cancellable hook `ask` (B5-8) | ~4 per platform + docs | withdraw an ask when the platform withdraws its callback | `ask` returns a handle | with S3/S5 if one is named |

**D3. The Document scope open question** (A4-03, B2-09, B3-06, B4-05b). `decisions.md:30-31` and the `shortcut:` at
`MinimalWebViewClients.kt:116-117` say pre-146 `onPageStarted` comes at load start, so a load that never commits ends
the Document spuriously. `:118-119`, `props.md:16, :67` and `harness.ts:1149-1150, :1869` say Chromium calls it at
commit, so such a load gets no events. Device evidence on WebView 133 favours commit: `props.md:67`'s chooser
cancelled "only when the next page commits", whose only pre-146 path is `newDocument()` from `onPageStarted`
(`MinimalWebView.kt:132`, `Clients.kt:122`). Options: (a) take "at commit" now: rewrite `decisions.md:30-31`, delete
`Clients.kt:116-117`; (b) first run `urlTracking` on mrw-api36 and read the INFO detail (`stopped` undefined, no
outcome), ~3 min; (c) also make `checkUnlessOldWebView` assert the old-WebView value (`harness.ts:222, 923-958,
1869-1876`), M. Lines: -2 comment, ~2 doc. Consumer cost: none. Breaks: nothing; the debt ledger loses a `shortcut:`.
Recommendation: (b) on W1's device run, then (a); if the probe shows load start, correct `props.md` and the harness
comments instead.

**D4. The aggregate-root decision** (B5-2, B5-4, B5-8, A1-04). (a) A `decisions.md` section "The view is the aggregate
root" (~10 lines): the Expo surface, the WebView's life, crash recovery, the Document scope, navigation state, hook
plumbing, and on iOS the one core delegate; the rule "a feature with state of its own owns it in its own class and
takes the view only for props, events and the current WebView; Swift `+Feature` files are one type split by file";
and why Core's request classes stay off the hook seam (4 of the 6 additions they'd need are core-only). (b) Also a pure
`Asks` class per platform (~25-30 lines moved and ~6 new each, plus JVM and swiftc tests of the ask contract: answer
once, late answer dropped, cancel answers null, `tell` at closing); with S-12 the Kotlin view drops to 14 functions. Breaks for
(b): NC's PAYLOADS rows for `onHookEvent` (askable) and `core.askCancelled` move files (new files top-level, NC:28-33);
the swiftc line in `development.md:11`; suites navigation, upload, permissions, sampleExtension. Consumer cost: none.
(c) A3 F2/F3's narrow interfaces: no (X6). Recommendation: (a) now, with S-06 and S-12; (b) as the one M item worth
doing, since the asks carried two of this audit's bugs (S-03, S-04) and only the device suites cover them.

**D5. detekt and SwiftLint thresholds, and the ratchet** (B4-08 to B4-15, B3-02, A1-01, A1-09, A1-10). After S-08 to
S-13, four findings remain. No global threshold is raised under the recommendation; each line below is the argument.

| Finding | B4's value | C1's correction | Recommendation |
|---|---|---|---|
| Kotlin `coerce` cyclomatic 24 | `ignoreSimpleWhenEntries: true` + one boxed `when` subject | measured: config alone 15 (still flagged), boxing alone 18, both 12 | adopt both: detekt then judges a flat `when` table as SwiftLint's `ignores_case_statements: true` already does (A1 question 1) |
| Kotlin view, 20 functions (11) | `thresholdInClasses: 21` (19 after S-12, 15 after D4(b)) | `@Suppress("TooManyFunctions")` with its reason; a global 21 lets every class grow to 20 | site `@Suppress` naming D4(a)'s section; global 11 stays |
| Swift view body 318 (250) | same-file `extension` for the navigation delegate methods (~225) | body 247, 3 lines of margin; the gain is to the number, not to reading | site `// swiftlint:disable type_body_length` with the same reason; no move |
| Swift view file 489 (400) | `file_length` warning 490 | the move makes 491; config 490 or move + 500 | site `// swiftlint:disable file_length` with the same reason; global 400 stays |

Trade-off: B4's exact values cap the views' growth but loosen every other class and file; site disables keep the
others at 11/250/400 and leave the views uncapped, which D4(a) makes a written design rule. Also: ESLint `'no-void':
'off'` (the 15 uses are fire-and-forget), `--fix` for 10, `example/harness.ts:102` by hand, then `--max-warnings 0`;
Periphery `--strict` after S-13. With those, all four tools exit 0 and fail on any new finding: no baseline files.
lizard: Swift and TS only without test dirs, or out (it misparses Kotlin, A1-10). Breaks: nothing at runtime.

**D6. Dropping `react-android` from downloads** (B1-7, plausible). It is used only at `requests/Downloads.kt:7-12`
(`ForwardingCookieHandler`, OkHttp), declared at `android/build.gradle:22`. Settle first, cheaply: delete the line and
run `:minimal-rn-webview:compileDebugKotlin`; `ExpoView` exposes an RN `StateWrapper`, so it may have to stay as
`compileOnly`. Options: (a) keep, 0 lines, coupled to an RN networking class and RN's OkHttp; (b) `HttpURLConnection`
plus `CookieManager`, +8 to +10 lines: a manual redirect loop (20 hops, relative `Location`, `disconnect`, timeouts per
connection, https-to-http refused per hop, which also refuses the http-https-http chain today's interceptor allows),
JVM-testable against the JDK `HttpServer` once the cookie read and write are passed in; (c) OkHttp with our own
`CookieJar`, ~10, keeps the dependency. Consumer cost: none (every RN app ships both; no size change). Breaks: the
`downloads` suite's redirect and cookie checks (`harness.ts:1863, 1888-1892`) must pass; no API change. C1: the test
gain isn't unique to (b), OkHttp with an injected `CookieHandler` tests the same way. Recommendation: (b) only if the
compile shows the gradle line can go entirely; otherwise (a).

**D7 to D16. Smaller decisions.**

| Id | Decision (sources) | Lines | Consumer cost | Breaks | Recommendation |
|---|---|---|---|---|---|
| D7 | Delete `context.activity` and Kotlin's detach reason (B2-04a,b; A4-04, A4-06) | -2, -3 | `appContext.currentActivity`, 1 line; read the reason in `onDocumentEnd` | public Kotlin hooks API; `native-hooks.md:26, 67` | delete both: one hooks shape (quality 2) |
| D8 | `NSHTTPCookie` through `call`: a `{ cookie }` tag (reject nil) and `properties` back (B2-12) | ~4 + docs | today an Expo module per consumer for iOS cookies from JS | nothing (additive) | add |
| D9 | One trailing-slash rule (in `onSource`, never `sameURL`) and one 60 s boundary; `vectors/recovery.json` read by both test trees (B3-08, B5-5b) | ~50 in 6 files, M | none | the platform that gives up its rule; `ShowsSourceTest.kt:17` if Swift's wins | Kotlin's (`/page` = `/page/`, 60 s inclusive): both are tested there |
| D10 | A5's P1 to P10 (~240 lines) and `WebView.tsx` in the 80% gate (B3-05, A5) | test only, M | none | `npm run mutation` +10 s | yes, after S-15 (A5 measured 91.1%) |
| D11 | Swift `PlatformSettings` test as a Mac Catalyst build (C1's correction of B3-09) | ~30-40 + 2 commands, S-M | none | a Catalyst build in the Swift loop | yes, if Catalyst is acceptable |
| D12 | `ref.hook` settles: each context rejects in-flight calls `unavailable` at detach (B4-03) | ~10 per platform, M | none | new rejections | doc now (S-20); code if hooks run long work |
| D13 | `context.url` in `onDocumentEnd(committed)`: Android 146+ the new page, iOS likely the ended one (B4-07, plausible) | swap `Clients.kt:60-61` + 1 doc line | none | hooks reading `url` there (none) | settle with S-19's device run, then swap so both report the ended page |
| D14 | Android bridge ordering: `documentEnded` after a hop (B4-17, plausible) | 1 comment, or a direct executor at `MinimalWebView.kt:154` | none | executor: rerun bridge and bfcache suites | add a head-script bridge call to the bridge suite; comment either way |
| D15 | Reload and back/forward redirects (B2-17, plausible) | 1 doc line; a second-request redirect route + suite case, M | none | nothing | align `migrating:210-211` with `navigation-rules.md` (matches the code); the case only if wanted |
| D16 | TS hook type registry: augmentable `HookTypes` behind `hookOptions`, `onHookEvent`, `hook` (B2-16) | ~15 + 15 type test | none | nothing | wait for a first outside extension |

## X: not doing

- X1. B1-1: every Core row keeps its place (re-affirmed, including get/call, warmUp/preconnect, the permanent SwipeRefreshLayout).
- X2. B1-3 refuted: seam S5 is not the one seam with a third-party use and core-only code (S2, S3, S4 are too); its per-load shape is in D2.
- X3. B3-09 refuted as stated: Swift settings coercion runs on the laptop as Mac Catalyst, no simulator; its CCN is 19, not 24. The corrected test is D11.
- X4. B3-12 refuted: a `settle()` barrier covers ~27 of 62 sleeps (~11 s of 38.8 s) and is unproven on Android Fabric.
- X5. B3-11: the navigation policy, recovery lifecycle, script transport, pull-to-refresh and fullscreen stay device-only; a fake would restate engine callback order.
- X6. B5-10: no `PageRequestHost` or `NavigationState` holder: `Uri.parse` and View APIs block JVM tests, and the holder removes no jump.
- X7. B2-16 (plausible): keep the untyped native boundaries; a `navigationRules` Record would fail open (verified); the cost figures weren't.
- X8. B4-02(d): `scriptHandlers.clear()` in `install()` is wrong as worded (it runs on the new WebView only); only a device run with `injectedScripts` across a crash would show harm.
- X9. B5-7(d): `PlatformSettings { webView }` only narrows a type and doesn't unblock the `coerce` test.
- X10. B2-14's rename of `hook_not_handled` to `not_found`: two separate code sets (A4-17, C1-docs); seven places change for no reader gain.
- X11. B3-02's committed baselines: superseded by every tool at zero (D5).
- X12. A3 F12 (shared helpers into a `Support.kt`): no B report took it up; it moves lines.
- X13. The gesture-gated default `external` and refusing the app's own scheme: still deferred; no report costed it.

## Questions only the maintainer can answer

1. "Small core": lines in the package (the glossary) or in the view and module classes, and physical or cloc lines? (B1, A2)
2. Is there a named use for seam S5, seam S3, `context.core` or a cancellable hook `ask`? (B1, B5)
3. Take "at commit" for pre-146 from the WebView 133 evidence, or run the mrw-api36 probe first (D3)? Which other device checks are worth a run: D13, D14, D15, D1's second NavigationListener?
4. The `Asks` class with laptop tests (M), or document the aggregate root and stop there? (D4)
5. Site disables or B4's exact global values for the two views; the flat-dispatch exemption in detekt; ESLint at zero with `no-void` off; lizard out? (D5)
6. Is a package free of RN internals worth a hand-written redirect loop, once the compile check is in? (D6)
7. Delete `context.activity` and Kotlin's detach reason (D7)? iOS cookies from JS without native code (D8)?
8. Recovery: does `/page` equal `/page/`, and is 60 s inclusive? (D9)
9. Test loop: a Mac Catalyst build for Swift settings (D11)? `WebView.tsx` in the 80% Stryker gate (D10)?
10. 1.5 for an integer setting: truncate silently (today) or reject with a warning? (B3)
11. `ref.hook` whose handler never replies: documented, or rejected at detach? (D12)
12. A TS hook type registry now, or with the first outside extension? (D16)
13. `java.net.URI` in `Permissions.originOf`, so the origin check (security code) runs on the JVM? (C1 on B5-10)
14. Are jest scrapes of native literals acceptable as the pin for values? S-16 assumes yes. (B5, A3)
15. Your setup: which iOS simulator is the reference in `development.md` (B3-10)? Keep `feature-tree/` (49 stale items), or only `metrics.tsv` and `A2-attribution.py` (A2)?
