# C1 verification: ios-rest (HEAD 8c0c1ca)

CONFIRMED 7 (B1-6, B2-02, B2-12, B4-06, B4-14, B5-3, B5-5), PLAUSIBLE 1 (B2-16), REFUTED 1 (B3-09).
Experiments, in `mktemp -d` dirs: the Swift matcher on bare-scheme URLs, a one-line scheme fix and the OriginRules struct run on the shared vectors, SwiftLint, and PlatformSettings.swift built and run as Mac Catalyst.
Biggest corrections: B5-5's drift is wider than stated (any `<scheme>:` with nothing after the colon); B3-09 needs no simulator; Swift coerce is not CCN 24.

## B1-6: CONFIRMED (iOS ~3-4 lines; Android's 22 sites recounted)
- Evidence: the decision goes to the first hook delegate that responds (`ios/DelegateProxy.swift:25-26`). The core implements all 7
  decision selectors (`ios/DelegateProxy.swift:44-52`) on `MinimalWebView`, which conforms to both protocols
  (`ios/MinimalWebView.swift:4`, `ios/MinimalWebView+Dialogs.swift:6`). So `var core: (WKNavigationDelegate & WKUIDelegate)? { get }`
  on `WebViewContext` (`ios/Hooks.swift:50`) and `var core: … { view }` on `HookContext` (`ios/Hooks.swift:76`) let a hook
  hand any decision back. Calling the core directly skips the proxy, so nothing recurses. Android: 24 `deciding(` lines
  minus the 2 definitions (`MinimalWebViewClients.kt:96,233`) = 22 sites.
- Caveat on "subsumes S4": that holds for one hook only. The second hook delegate never sees the response
  (`DelegateProxy.swift:25`), and an S4-style split would let every hook observe it. Hooks already get `didBecome download`
  when the core downloads (`MinimalWebView.swift:376-387`).
- Smallest change: iOS as above, S. Android: each core client method calls `deciding` first, so a hook calling it
  recurses into itself (`MinimalWebViewClients.kt:109`). A ThreadLocal bypass flag (needed because of
  `shouldInterceptRequest`, `Hooks.kt:143`) read in the two `deciding` helpers is ~8 lines. But `onShowFileChooser` holds the
  callback before `deciding` (`MinimalWebViewClients.kt:244-245`), and wrapping it twice drops the answer
  (`MinimalWebView.kt:328-334`: the inner wrapper nulls `fileChooser`, so the outer returns early). With that one site
  special-cased it is S-M. M is a fair upper bound.
- Breaks: any consumer type conforming to the public `WebViewContext` (none in the repo:
  `example/modules/sample-extension/ios/SampleExtensionModule.swift:61,82` only holds a reference). The text at `docs/native-hooks.md:43-48` ("the core steps
  aside") also has to change. This is a deferred item: it is costed, not implemented.

## B2-02: CONFIRMED
- Evidence: `HookContext.emit`/`ask` call the view on the caller's thread (`ios/Hooks.swift:102-109`). `ask` goes on to
  `register`, which mutates `nextAskId`/`pendingAsks` (`ios/MinimalWebView+Navigation.swift:94-97`, via
  `ios/MinimalWebView.swift:486-488`). The main queue mutates the same dictionary in `answer` (`ios/MinimalWebViewModule.swift:8,55`) and in
  `failPendingAsks` (`+Navigation.swift:109-111`). Kotlin hops to main (`Hooks.kt:119-122,143-146`). `docs/native-hooks.md:69` says "Everything runs on the main thread".
  `emit` alone doesn't race (Fabric's dispatcher, `EventDispatcher.swift:39-42`).
- Limit: no WebKit callback the core forwards runs off main. The race needs a hook's own background work, for example a
  URLSession completion.
- Smallest change: Kotlin's `onMain` in `HookContext` (`Thread.isMainThread ? block() : DispatchQueue.main.async`), about 4 lines,
  S. A doc line at `native-hooks.md:69` ("call emit/ask on main on iOS") is smaller but leaves the platforms asymmetric.
- Breaks: nothing in tests (`ios/Tests/main.swift` doesn't compile Hooks.swift). An off-main ask's answer becomes async.

## B2-12: CONFIRMED
- Evidence: `MRWObject` makes only NSSet, NSDate and NSData from tags (`ios/MRWInvoke.m:41-49`). Any other dictionary is passed
  as is, which `ios/MRWInvoke.h:11-12` calls undefined behaviour. So `httpCookieStore.setCookie:completionHandler:` and
  `deleteCookie:` can't get an NSHTTPCookie, and `getAllCookies:` returns `[null, …]` (`MRWInvoke.m:37`).
  `docs/platform-settings.md:114` sends that case to a native hook. Android's `cookieManager.setCookie(String, String)` and
  `getCookie(String)` take strings (`android/.../PlatformSettings.kt:103`, `docs/platform-settings.md:74`).
  `document.cookie` through `evaluate` can't reach HttpOnly cookies.
- Smallest change: a `{ cookie: {Name, Value, Domain, Path, …} }` tag → `[NSHTTPCookie cookieWithProperties:]` in
  `MRWObject`. Reject a nil result, since `MRWInvoke.m:85-87` would pass nil to a nonnull parameter. Add `NSHTTPCookie → properties`
  in `MRWJsonable` (`MRWInvoke.m:20-38`). About 3-4 lines plus docs (`MRWInvoke.h:5-8,16-18`, `platform-settings.md:82-85,103-105`). S.
- Breaks: nothing (additive). `MRWObject`'s single-key guard (`MRWInvoke.m:43`) already fits the tag. `get`/`call` stay (a keep).

## B2-16: PLAUSIBLE (keep)
- Verified part: a `navigationRules` Record would fail open. Expo drops a prop that fails to convert
  (`example/node_modules/expo-modules-core/ios/Fabric/ExpoFabricView.swift:98` `try?`, noted at `ios/MinimalWebViewModule.swift:95`).
  One mistyped field would then leave `navigationRules` nil, and the defaults allow http(s) (`ios/NavigationRules.swift:48-50`).
  Today the mistyped field matches nothing and blocks (`ios/NavigationRules.swift:73-75`, `NavigationRules.kt:78-79`).
- Unverifiable here: "typed alternatives cost 3-150 lines and catch less" has no enumerated alternatives to recount.
  The untyped boundaries are `ios/Hooks.swift:52,60-69`, `ios/MinimalWebViewModule.swift:15,17-20,23` and `Hooks.kt:71,85-100`.
  The TS registry would be types only (`src/types.ts:245,300,305,396`), so it's plausibly S.
- Smallest change: none (keep). The size should read "none", not M. Breaks: nothing.

## B3-09: REFUTED
- "Cannot join the macOS swiftc build … run via simctl spawn": on the plain macOS target the file fails (`no such module 'UIKit'`,
  `ios/PlatformSettings.swift:2`). But built as **Mac Catalyst** it compiles and runs on the laptop with no simulator. I built
  `ios/MRWExceptions.m` and `ios/MRWInvoke.m` with clang (`-target arm64-apple-ios16.4-macabi`, `-iframework <macOS SDK>/System/iOSSupport/...`),
  then `PlatformSettings.swift` plus a scratch main with swiftc and the same target. `apply` on a `WKWebViewConfiguration`
  printed the expected rejections ("a B property can't take yes", "no such property") and set the Bool. The simulator-SDK
  build also links (platform 7), but it isn't needed.
- "CCN 24" is not Swift's number. SwiftLint gives `coerce` (`PlatformSettings.swift:143`) 19 counting cases, and 4 under the
  repo's `ignores_case_statements: true` (`.swiftlint.yml`). 24 is detekt's figure for Kotlin's `PlatformSettings.coerce` (plan §3).
- Smallest change: the test is still worth adding, but cheaper. A Catalyst main exercising `apply` for each type encoding, through
  `configuration`/`preferences` objects, since `coerce` is private: ~30-40 lines, plus a 2-command entry in `docs/development.md`. S-M.
- Breaks: nothing. Catalyst lacks a few iOS-only WebKit properties, so the test picks properties per encoding that exist on both.

## B4-06: CONFIRMED
- Evidence: the state is in `ios/MinimalWebView.swift:63,67`, `ask` at `:486-488` and the teardown fail at `:257`. The registry functions are in
  `ios/MinimalWebView+Navigation.swift:94-111`. The module removes from `view.pendingAsks` itself (`ios/MinimalWebViewModule.swift:55`).
  Kotlin keeps `pendingAsks` private (`MinimalWebView.kt:100`) behind `answer` (`:316-318`, `MinimalWebViewModule.kt:145`).
- Smallest change: `func answer(_ id: Int, _ value: Any?)` next to `register` (3 lines), with the module calling it (1 line). S. Getting the
  state into one file would need a registry type (~20 lines, M), because stored properties can't live in an extension. Not needed.
- Breaks: nothing. `nativeContract.test.ts` doesn't reference `pendingAsks`, and the `AsyncFunction("answer")` name is unchanged.

## B4-14: CONFIRMED
- Evidence: `ios/OriginRules.swift:27` returns a 4-member tuple; SwiftLint at HEAD: `OriginRules.swift:27:48: error: Large Tuple
  Violation`. (Plan §3 calls it a 3-tuple; the finding's 4 is right.)
- Smallest change: `private struct Parsed { let scheme: Substring, wildcard: Bool, host: Substring, port: Int }`, constructed
  in `parse`. `allows` (`:15-21`) is unchanged. +2 lines, S. Tried it: 53/53 origin cases pass, and large_tuple is clean.
  `// swiftlint:disable:next large_tuple` (1 line) would only silence the rule.
- Breaks: nothing. The SwiftLint baseline goes from 5 findings to 4.

## B5-3: CONFIRMED (both platforms)
- iOS: `tearDown` fails the asks (`MinimalWebView.swift:257`) and only then runs the detach closures (`:259`). An ask from a
  detach closure, or from a kept context after `invalidate` while the view is still alive, registers
  (`MinimalWebView.swift:486-488`). Deinit's `tearDown` then returns at `guard let webView` (`:254`, `webView` is nil since `:270`),
  so `onAnswer` is released uncalled. That contradicts `ios/Hooks.swift:61` and `docs/native-hooks.md:54,70-71`. During
  deinit itself the weak `view` is nil, so that case does answer nil (`Hooks.swift:107`).
- Android: `HookContext` holds the view strongly (`Hooks.kt:107`), and `ask` has no `destroyed` check (`MinimalWebView.kt:303-312`).
  `destroy` (`:409-417`) runs `failAsks` inside `document.end(CLOSING)` before the hooks' own `onDocumentEnd` handlers
  (`:135` before `:137`), and `detachHooks` (`:414`) after that. So asks from either are never settled, and Android has no second
  fail like iOS's `:257`. That contradicts `Hooks.kt:87`.
- Smallest change: iOS `private var closed` set in `tearDown` after the guard, plus `guard !closed else { return onAnswer(nil) }` in
  `ask` (3 lines). Android `if (destroyed) return onAnswer(null)` in `MinimalWebView.ask` (1 line; `destroyed` is set first, `:410`). S.
  Then make the docs symmetric: `native-hooks.md:70-71` says "On iOS".
- Breaks: nothing in the tests. Asks from CRASHED detach closures on Android are unaffected.

## B5-5: CONFIRMED, and wider than stated
- Scheme: `split(separator: ":", maxSplits: 1)` drops the empty remainder (`ios/NavigationRules.swift:42-43`), so `X:` reads as scheme "".
  Run with no rules: `about:`/`javascript:` in the main frame → `external`, as a new window → `external`. Kotlin reads the
  scheme with `substringBefore(':', "")` (`NavigationRules.kt:38`), which gives allow and block (`:41-42`). Also `myapp:` with
  `{scheme:["myapp"], action:"external"}`: Swift `block/nil`, Kotlin `external/0`. No vector has a bare `X:`
  (`src/__tests__/vectors/navigation-rules.json:193,205,263,323` all have text after the colon).
- Fix tried: `request.url.firstIndex(of: ":").map { request.url[..<$0].lowercased() } ?? ""` gives 79/79 vectors and
  Kotlin's answers on all four inputs. Add 3 vector cases (`about:` main frame, `about:` new window, `myapp:` scheme rule), which run on both platforms. S.
- Source detection: Kotlin `showsSource` trims trailing `/` (`MinimalWebView.kt:485-490`), and `ShowsSourceTest.kt:17` asserts
  /page == /page/. Swift `onSource` (`MinimalWebView.swift:164-168`) uses `sameURL`, which only maps an empty path to "/"
  (`MinimalWebView+Navigation.swift:114-121`). There is no shared vector: the vectors cover only navigation and origin rules.
- Smallest change: the maintainer picks the semantics, and the change goes in `onSource` only, never in `sameURL`. `sameURL` also decides
  `own` (`+Navigation.swift:13`), and making it lenient would skip the rules for a /page→/page/ redirect that Kotlin
  does check (`MinimalWebViewClients.kt:106`). A Swift test needs the comparison moved out of the UIKit/WebKit extension
  into a Foundation-only file that `ios/Tests/main.swift` compiles. S-M.
- Breaks: on iOS, `about:`/`javascript:` and bare `X:` URLs change decision, so the vectors grow. Taking Swift's semantics flips
  `ShowsSourceTest.kt:17`.

```json
[
 {"id":"B1-6","verdict":"CONFIRMED","evidence":"DelegateProxy.swift:25-26,44-52; MinimalWebView.swift:4; MinimalWebView+Dialogs.swift:6; 22 deciding( call sites in MinimalWebViewClients.kt (24 lines minus defs :96,:233); subsumes S4 only for the first hook delegate","smallest_change":"iOS: core property on WebViewContext + HookContext returning view (~3 lines). Android: ThreadLocal bypass in the two deciding helpers (~8 lines) plus special-casing onShowFileChooser (MinimalWebViewClients.kt:244, MinimalWebView.kt:328-334)","size":"S (iOS), S-M (Android)","breaks":"consumer types conforming to the public WebViewContext (none in repo); native-hooks.md:43-48; deferred item, cost only"},
 {"id":"B2-02","verdict":"CONFIRMED","evidence":"Hooks.swift:102-109 no hop; register mutates pendingAsks (+Navigation.swift:94-97) vs main-queue answer (MinimalWebViewModule.swift:55); Kotlin Hooks.kt:119-122,143-146; native-hooks.md:69; needs a hook's own background work, no forwarded WebKit callback is off main","smallest_change":"onMain hop in HookContext.emit/ask (~4 lines); or doc line at native-hooks.md:69","size":"S","breaks":"nothing; off-main ask answer becomes async"},
 {"id":"B2-12","verdict":"CONFIRMED","evidence":"MRWInvoke.m:41-49 tags only set/date/data; MRWInvoke.h:11-12 wrong class is UB; MRWInvoke.m:37 NSHTTPCookie results become null; platform-settings.md:114; Android cookieManager takes strings (PlatformSettings.kt:103)","smallest_change":"{cookie:{...}} tag -> NSHTTPCookie cookieWithProperties (reject nil) in MRWObject; NSHTTPCookie -> properties in MRWJsonable; docs","size":"S","breaks":"nothing (additive); docs MRWInvoke.h, platform-settings.md"},
 {"id":"B2-16","verdict":"PLAUSIBLE","evidence":"Record fail-open confirmed: ExpoFabricView.swift:98 try? drops the prop, defaults allow http(s) (NavigationRules.swift:48-50) vs today's mistyped-field-blocks (NavigationRules.swift:73-75); the 3-150 line costs cite no enumerable alternatives","smallest_change":"none (keep); TS-only hook registry in src/types.ts if wanted","size":"none (TS registry S)","breaks":"nothing"},
 {"id":"B3-09","verdict":"REFUTED","evidence":"PlatformSettings.swift + MRWExceptions.m + MRWInvoke.m built with -target arm64-apple-ios16.4-macabi and run on macOS: apply() rejected and set as expected; no simulator needed. Swift coerce is CCN 19 (SwiftLint, cases counted) / 4 (repo config); 24 is Kotlin's detekt figure","smallest_change":"Mac Catalyst test main exercising apply() per type encoding (~30-40 lines) + 2 commands in docs/development.md","size":"S-M","breaks":"nothing; pick properties that exist on Catalyst"},
 {"id":"B4-06","verdict":"CONFIRMED","evidence":"state MinimalWebView.swift:63,67, ask :486-488, teardown :257; functions MinimalWebView+Navigation.swift:94-111; module writes view.pendingAsks at MinimalWebViewModule.swift:55; Kotlin private + answer (MinimalWebView.kt:100,316-318)","smallest_change":"answer(_:_:) beside register (3 lines), module calls it (1 line)","size":"S","breaks":"nothing; nativeContract.test.ts unaffected"},
 {"id":"B4-14","verdict":"CONFIRMED","evidence":"OriginRules.swift:27 4-member tuple; swiftlint: 27:48 error large_tuple","smallest_change":"private struct Parsed (+2 lines); verified 53/53 origin cases, large_tuple clean","size":"S","breaks":"nothing; SwiftLint baseline 5 -> 4"},
 {"id":"B5-3","verdict":"CONFIRMED","evidence":"iOS: detachers run after failPendingAsks (MinimalWebView.swift:257,259), ask registers (:486-488), deinit tearDown returns at :254; Android: HookContext strong view (Hooks.kt:107), no destroyed check (MinimalWebView.kt:303-312), failAsks (:135) before hooks' onDocumentEnd (:137) and detachHooks (:414)","smallest_change":"iOS closed flag + guard in ask (3 lines); Android if (destroyed) onAnswer(null) in ask (1 line); make native-hooks.md:70-71 symmetric","size":"S","breaks":"nothing"},
 {"id":"B5-5","verdict":"CONFIRMED","evidence":"NavigationRules.swift:42-43 reads any bare 'X:' as scheme '' (ran: about:/javascript: -> external main frame and new window; myapp: scheme rule -> block) vs NavigationRules.kt:38,41-42; showsSource trims '/' (MinimalWebView.kt:485-490, ShowsSourceTest.kt:17) vs sameURL (MinimalWebView+Navigation.swift:114-121) via onSource (MinimalWebView.swift:164-168)","smallest_change":"one-line firstIndex(of: \":\") scheme parse (verified 79/79) + 3 vector cases; source detection: pick semantics, change onSource only (not sameURL, which also decides own at +Navigation.swift:13), move the comparison to a Foundation-only file for a Swift test","size":"S (scheme), S-M (source)","breaks":"iOS decisions for bare-scheme URLs; vectors grow; ShowsSourceTest.kt:17 if Swift semantics win"}
]
```
