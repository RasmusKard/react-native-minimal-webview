# B1: Minimal core (audit-2026-10-23 @ e400de9; code unchanged since 333f05f)

**Summary.** (1) Pass with items: each of A2's 20 rows is in Core for reason (a), (b) or (c) of plan §1 row 1. None is
a cut candidate, and nothing stopped earning its place after PR #36. (2) The three deferred moves don't shrink Core as
the glossary defines it (the package's own native code): an in-package extension moves 30 to 210 lines out of the view
and request files and adds about 6 to 40 to the package. As recipes all three fail (c). Keep them. (3) Worth deciding:
S5 (before-load gate) and iOS `context.core`, for third parties, not for the moves; and dropping `react-android` from
downloads (about +10 lines, which makes the redirect loop testable on the JVM).

Measure: physical lines (`wc -l`), the same as A2 and the yardstick. cloc code lines at HEAD: Kotlin 1,710, Swift 1,176,
ObjC 168, TS 920. A2's row split is medium confidence, and its starred rows (BFC, NS, PS, Other, Glue, DS) are low.
Classes here are plan §1's reasons, not A2's (a) to (d) letters.

## Verdict: pass with items

- Core is 5,552 physical lines (A2, +674 since 806d16f; 434 of the 674 are Hooks, Bridge, Crash recovery and
  Navigation). The rows held only by (c) are shared cookies 86, pull-to-refresh 96, download saving about 293 and
  warmUp/preconnect 40, about 515 lines (9%). get/call (377) and the permissions JS path are (c) and kept by decision.
- **Yardstick** (counted by hand): `example/modules/sample-extension` is 7 files and 249 lines for three hooks: Kotlin 86,
  Swift 103, TS 17, config 43 (`package.json` 7, `expo-module.config.json` 5, `android/build.gradle` 18, podspec 13).
  On top of that come one dependency line in the app (`example/package.json:11`) and a native rebuild. The fixed cost of
  any out-of-package feature is the 4 config files plus the module skeletons (`SampleExtensionModule.kt:1-19`,
  `SampleExtensionModule.swift:1-12`): about 70 lines before the first line of feature code.

| Row (A2 lines) | Reason it is in Core today | Consumer cost if it left the package |
|---|---|---|
| File upload, Android (110) | (a) `<input type=file>` does nothing without `onShowFileChooser` (`MinimalWebViewClients.kt:248`); `onFileRequest` (c) | an Expo module plus a picker |
| Fullscreen video, Android (114) | (a) the default ignores `onShowCustomView` | — |
| JS dialogs (92) | (a) iOS: alert, confirm and prompt are no-ops without a UI delegate (`MinimalWebView+Dialogs.swift:6`); Kotlin 16 lines are (b) routing | — |
| Crash recovery (139) | (a) `onRenderProcessGone` must return true or the app dies (`MinimalWebViewClients.kt:217-223`) | — |
| BFC, Android (12) | (a) back restores the page, as WebKit does (`MinimalWebView.kt:170-174`) | — |
| Download default (~35) | (a) an untaken file is shown as a page or does nothing (`MinimalWebView.swift:361-368`, `MinimalWebView.kt:150-153`) | — |
| Navigation rules + ask (563), state (574) | (a) the platform has no rules and no state common to both platforms; the package's purpose | — |
| Permissions (140) | (a) main-frame origin check (`Permissions.kt:47`); the JS path is kept | — |
| Hooks (639), ask plumbing (144), settings (393), DocumentScope (69) | (b) the seams: hooks, asks, settings roots, Document end | — |
| Bridge (879) | (a) origin checks plus (c); kept | — |
| get / call (377) | (c), kept (2026-10-15) | one module per platform call |
| warmUp / preconnect / defaultUserAgent (40) | (c) | Android-only module: 29 config + ~12 skeleton + ~25 Kotlin (`MinimalWebViewModule.kt:80-107`) + ~15 TS ≈ 80 + rebuild |
| Shared cookies, iOS (86) | (c) | iOS-only module: ~24 config + ~12 skeleton + ~55 Swift ≈ 90 + rebuild, and still wrong on the first load: nothing can hold it (`preparing` is private, `MinimalWebView.swift:71`) |
| Pull-to-refresh (96) | (c) | 43 + 27 + ~76 Kotlin + ~30 to reparent, measure, reload and see the load end + ~20 Swift ≈ 195 + rebuild |
| Download saving (~293) | (c) | 43 + 27 + ~180 security-sensitive Kotlin + ~45 Swift ≈ 295 + rebuild, against "don't touch Android's download listener" (`docs/native-hooks.md:72-73`) |
| Module glue (192), other (565) | plumbing for the (a) rows | — |

**(iii) Nothing stopped earning its place after PR #36.** Checked: get/call (`ref.hook` serves extension authors; an
app without a module still needs `call`), warmUp/preconnect/defaultUserAgent (no view, so neither `hookOptions` nor
`ref.hook` reaches them), the iOS `preparing` gate (one user, but it is S5 waiting to be exposed), `webViewClass` and
`webViewFactory` (the only way to use a subclass), and Android's SwipeRefreshLayout, which wraps every WebView even with
the prop off (`MinimalWebView.kt:127-129`, `PullToRefresh.kt:21-29`). 3d4ee57 made that wrap permanent so that a crash
can swap the WebView inside it and the prop toggles live. Keep it.

## Decision packet

**The framing decides the answer.** The glossary's "Core" (`docs/glossary.md`) is all of the package's native code, so
an in-package extension moves lines without removing any. A move pays only if fewer lines in the view and request
files are worth the added seams and glue (core-size question 2, still open).

**What any in-package extension has to work around (verified at HEAD):**
- C1. A hook attaches only if its key is on when the WebView is created (`MinimalWebView.kt:142`,
  `MinimalWebView.swift:214`). Turning it on later only warns (`MinimalWebView.kt:292-293`, `MinimalWebView.swift:453-454`).
  A live prop backed by a hook therefore needs WebView.tsx to always send a non-false value (`{ enabled }`), and the
  hook then attaches to every WebView.
- C2. Hooks run in registration order, and the first one to claim a decision wins (`Hooks.kt:34-35`,
  `Hooks.swift:17-18`). The package's own hooks would register in its module's `OnCreate`, so whether they come before
  or after the app's hooks depends on Expo's module order. Putting built-ins last costs about 3 lines.
- C3. Each prop stays and feeds `hookOptions`, and the extension's events are routed back to the same props: 2 to 5
  TS lines per move.

| Move | Leaves the view/module | Seams added | Glue + TS | Net package | Consumer | What breaks | Recommendation |
|---|---|---|---|---|---|---|---|
| sharedCookies (iOS) | 18 (`MinimalWebView.swift:31-32, 70-71, 124, 133-143, 233, 258`), plus edits at :117, :130 and `MinimalWebViewModule.swift:22` | S5 iOS ~10 (generalises `preparing`); the Android twin ~12 for symmetry, optional | ~12 + 2 | **+6** (+18 with Android S5) | none, the prop stays | `sharedCookies` becomes a taken hook key; the crash reload (`MinimalWebView.swift:432`) still skips the gate | keep, unless S5 is wanted for itself (Q2); then its first user |
| pull-to-refresh | Android 7 touch lines (`MinimalWebView.kt:71-72, 129, 192, 342, 374, 400`) + `PullToRefresh.kt` 76 moved; iOS 12 (`MinimalWebView.swift:24-30, 109, 122-123, 414-415`); 2 props | S2 ~10, S6 ~6, **S7 ~8**, a load-end observation that core-size missed (finding 4) | ~30 + 2 | **+38** | none | the WebView is no longer always inside a SwipeRefreshLayout; the vh=0 layout-params fix (`MinimalWebView.kt:209-212`) has to move with the wrapper | keep |
| download saving | Android `Downloads.kt` 174 moved; iOS `Downloads.swift:39-74` (36) moved; `:37` and the `downloads` members change | S3 ~8; iOS S4 ~10, or `context.core` ~4 | ~22 + 5 | **+38**; view and request files −210 | none | `core.download` (pinned in `nativeContract.test.ts`) gets renamed; claim order against app hooks (C2); the blob read loses the core evaluate's checks (`MinimalWebView.kt:349-350`) | keep; add S3 alone if a download-manager extension is named (Q3) |

**The seams on their own** (useful to third parties whether or not anything moves):

| Seam | Lines | What it unblocks | Recommendation |
|---|---|---|---|
| S2 content wrapper (Android) | ~10 | native UI around the WebView; no listed sketch needs it | don't add |
| S3 download listeners (Android) | ~8 | a hook that saves or tracks downloads; today it may not touch the listener | on demand (Q3) |
| S4 response-policy split (iOS) | ~10 | seeing responses without switching off `http` errors and the download default (`docs/native-hooks.md:46-48`) | superseded by `context.core` on iOS |
| S5 before-load gate | ~10 iOS + ~12 Android | async setup before each `source` load (a content-rule list, extension-gaps finding 3 / sketch 9); the code exists as `preparing` | yes, if a use is named (Q2); sharedCookies moves onto it |
| S6 `context.reload()` | ~6 | a hook reload with the core's POST and failed-URL handling (`MinimalWebView.kt:241-251`); JS already has `ref.reload()` | don't add |
| `context.core` (deferred) | iOS ~4: the view already implements both delegate protocols (`MinimalWebView.swift:4`, `MinimalWebView+Dialogs.swift:6`); Android M: 22 `deciding(` sites, `MinimalWebViewClients.kt:96, 233` | a hook declines a decision and lets the core decide ("this one host, else the core") | maintainer; both platforms or neither |
| `holdLoads()` (deferred) | = S5 limited to the first load | not enough for cookies, which have to be copied before *every* `source` load (`SharedCookies.swift:28-29`) | take S5's per-load form instead |

**(iv) `react-android` for downloads.** It is used only at `requests/Downloads.kt:7-12` (grep of `android/src/main`), and
`android/build.gradle:21-22` declares it. expo-modules-core takes it as `implementation` only
(`node_modules/expo-modules-core/android/build.gradle:317`), so it doesn't reach our classpath through Expo.
- **Keep** (0 lines): we stay coupled to `ForwardingCookieHandler`, an RN networking class, and to OkHttp at RN's version.
- **HttpURLConnection + CookieManager** (net about +10): a redirect loop of about 20 lines replaces the client
  (`Downloads.kt:157-172`) and the request (`:55-59, 73`). Each hop sends `CookieManager.getCookie(url)`, and each
  `Set-Cookie` goes to `setCookie` followed by `flush()`. That is all RN's handler does
  (`ForwardingCookieHandler.kt:29-58`). The loop has to refuse https to http and any non-http(s) `Location`, which
  OkHttp did for us, and cap the hops (OkHttp allows 20). With the cookie functions passed in, the loop becomes a JVM test
  against the JDK's HttpServer. Today `Downloads.fetch` (cognitive complexity 23) runs only on a device, where the
  `downloads` suite covers sending the cookie and a cross-host 302 (`harness.ts:1852, 1862`, `server.js:282-283`), but
  not https to http and not `Set-Cookie` written back. Unverified: whether the gradle line can go entirely.
  `ExpoView` declares `stateWrapper: StateWrapper?`, an RN type (`ExpoView.kt:19` in expo-modules-core), and one
  `./gradlew` build would show whether a subclass still compiles without RN; if not, the line becomes `compileOnly`.
  Smaller differences: no HTTP/2, and an app's `CookieHandler.setDefault` would also be consulted.
- **Keep OkHttp with our own CookieJar** (~10): drops the RN class but not the dependency. Not worth it.
- No consumer cost under any option: every RN app ships `react-android`. Recommendation: HttpURLConnection with the
  JVM test, if the package should be free of RN internals (Q4); otherwise keep.

## Findings, ranked

**B1-1** Every Core row has a reason ((a) 9, (b) 4, (c) 5, plus plumbing), and none stopped earning its place after
PR #36. Evidence: the table above; `docs/glossary.md` "Core". Quality 1. **keep**. S. Confidence: high on the classes,
medium on A2's per-row lines. Breaks nothing.

**B1-2** None of the three deferred moves shrinks Core: as in-package extensions they cost the package about +6, +38
and +38 lines, and as recipes each costs a consumer more than the library (~90, ~195, ~295 lines plus a rebuild,
against 86, 96 and ~293). Evidence: the packet; `MinimalWebView.swift:31-32, 133-143`, `PullToRefresh.kt:15-65`,
`Downloads.kt:37-174`. Quality 1. **keep**, and close the 2026-10-22 deferral. S. Medium. Breaks nothing.

**B1-3** S5 is the one seam with a named third-party use (async setup before a load) and a working one-user
implementation already in place (`MinimalWebView.swift:70-71, 117, 130, 133-143`). If it is added, sharedCookies is
its first user (+6 iOS, +18 with the Android twin). Quality 1, 5. **add-seam**, if the maintainer names a use. M. Medium.
Breaks: a new required member on the public `WebViewContext` (`Hooks.swift:50`, `Hooks.kt:69`), so a fake that
implements it no longer compiles.

**B1-4** A hook attaches only if its key is on at creation. A hook-backed live on/off switch must therefore send an
always-on value, and every in-package move and every third-party toggle depends on this. The rule is documented, but the
`{ enabled }` way around it is not. Evidence: `MinimalWebView.kt:142, 292-293`, `MinimalWebView.swift:214, 453-454`,
`docs/native-hooks.md:38-42`, `types.ts:296-298`. Quality 1, 2. **document**: one sentence in native-hooks.md. S. High.
Breaks nothing.

**B1-5** Moving pull-to-refresh on Android needs a seventh seam that core-size didn't list. The spinner stops on the
NavigationListener's load end, which covers restored pages and loads that never commit
(`MinimalWebViewClients.kt:59-84`, `MinimalWebView.kt:342`, `PullToRefresh.kt:41-45`). A hook only has
`onPageFinished`, and a spinner that stays up ignores the next pull. Quality 1, 5. **document** (in the move's cost).
S. Medium (`onPageFinished` was not checked on device for each such load). Breaks nothing.

**B1-6** iOS `context.core` (~4 lines) gives what S4 would give, plus the iOS half of "decision hooks fall back to the
core". Android's half is M, because 22 routed decisions would each need a version that skips the routing. Evidence:
`DelegateProxy.swift:24-29, 44-52`, `MinimalWebView.swift:4`, `MinimalWebViewClients.kt:96, 233`. Quality 1, 2.
**add-seam** (maintainer; both platforms or neither). M. Medium. Breaks: a new protocol and interface member.

**B1-7** `Downloads.kt` is the only user of `react-android` and OkHttp. HttpURLConnection plus CookieManager can drop
both for about +10 lines, and the redirect and cookie loop then becomes testable on the JVM. Evidence:
`android/build.gradle:21-22`, `Downloads.kt:7-12, 157-172`. Quality 5, 3. **simplify** + **test**. M. Medium (whether the
gradle line can go needs one build). Breaks: no API; the redirect handling is written by hand.

**B1-8** On iOS a hook can already own download saving while `onDownload` is set. The core assigns its own
`WKDownloadDelegate` and then forwards `didBecome` to the hooks, so the last assignment, the hook's, wins. Only "is this a
download" stays with the core. Evidence: `MinimalWebView.swift:376-387`, `Downloads.swift:24-35`; not in
`docs/native-hooks.md`. Quality 1, 2. **document**. S. Medium (read, not run). Breaks nothing.

## Out of slice

- The gesture-gated default `external` and refusing the app's own scheme (deferred): a navigation and security
  question, not one of size. B2/B4 or the maintainer.
- Kotlin `clients`, `chromeClients`, `activity`, `emit` and `ask` are public on the view (`MinimalWebView.kt:83-85, 301-303`)
  but only `HookContext` uses them (A3). B2/B5.
- `register` refuses only the key `core` (`Hooks.kt:50`, `Hooks.swift:31`). Built-in hook keys would need the same
  guard. B2.
- iOS crash recovery reloads `source` without the shared-cookie copy (`MinimalWebView.swift:432`); the WebView's store
  survives the crash, but cookies set natively since the last load are missed. B3/B4 to confirm.

## Questions only the maintainer can answer

1. "Small core": fewer lines in the package (the glossary), or fewer in the view and module classes? Under the first,
   no move pays. Under the second, only download saving moves more than 100 lines.
2. Is there a real use for S5 (a content-rule list or other async setup before a load)? If yes: S5 on both platforms,
   with sharedCookies as its first user. And should a held load also hold the crash-recovery reload (extension-gaps
   question 6)?
3. The same for S3 (an Android download manager) and `context.core` ("one self-signed host, else the core";
   `intent:` URLs, rules for the rest).
4. Is a package with no `react-android` worth a hand-written redirect loop and its JVM test?

```json
[
{"id":"B1-1","file":"docs/audit/2026-10-23/A2-features.md","line":19,"quality":1,"claim":"Every Core feature row is there for reason (a), (b) or (c); none is a cut candidate and nothing stopped earning its place after PR #36","recommendation":"keep","size":"S","confidence":"high"},
{"id":"B1-2","file":"ios/MinimalWebView.swift","line":133,"quality":1,"claim":"The three deferred moves (sharedCookies, pull-to-refresh, download saving) add about +6, +38 and +38 package lines as in-package extensions and cost each consumer more than the library as recipes; none shrinks Core as the glossary defines it","recommendation":"keep","size":"S","confidence":"medium"},
{"id":"B1-3","file":"ios/MinimalWebView.swift","line":71,"quality":1,"claim":"S5 (before-load gate) is the one seam with a third-party use and an existing one-user implementation (preparing); sharedCookies would be its first user","recommendation":"add-seam","size":"M","confidence":"medium"},
{"id":"B1-4","file":"android/src/main/java/expo/modules/minimalwebview/MinimalWebView.kt","line":142,"quality":1,"claim":"A hook attaches only if its key is on at WebView creation, so a hook-backed live toggle must send an always-on value; the {enabled} pattern is not documented","recommendation":"document","size":"S","confidence":"high"},
{"id":"B1-5","file":"android/src/main/java/expo/modules/minimalwebview/MinimalWebViewClients.kt","line":59,"quality":1,"claim":"Android pull-to-refresh as a hook needs a load-end observation seam that core-size did not list: the spinner stops on the NavigationListener's end, which hooks cannot see","recommendation":"document","size":"S","confidence":"medium"},
{"id":"B1-6","file":"ios/DelegateProxy.swift","line":24,"quality":1,"claim":"iOS context.core (about 4 lines) subsumes S4 and the iOS half of decision fallback to the core; Android's half is M over 22 deciding sites","recommendation":"add-seam","size":"M","confidence":"medium"},
{"id":"B1-7","file":"android/src/main/java/expo/modules/minimalwebview/requests/Downloads.kt","line":7,"quality":5,"claim":"Downloads.kt is the only user of react-android and OkHttp; HttpURLConnection plus CookieManager drops both for about +10 lines and makes the redirect and cookie loop JVM-testable","recommendation":"simplify","size":"M","confidence":"medium"},
{"id":"B1-8","file":"ios/MinimalWebView.swift","line":376,"quality":1,"claim":"On iOS a hook can already own download saving while onDownload is set, because didBecome is forwarded after the core assigns its delegate; native-hooks.md does not say so","recommendation":"document","size":"S","confidence":"medium"}
]
```
