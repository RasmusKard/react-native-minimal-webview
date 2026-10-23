# C1 verification: android-hooks-clients (HEAD 8c0c1ca)

CONFIRMED 7 (B2-04, B2-11, B3-11, B4-04, B4-12, B4-16, B5-8), PLAUSIBLE 3 (B1-5, B4-07, B4-17), REFUTED 0.
Two findings are the same bug: B2-04's third part is B4-04 (ask after close), and it affects iOS too. The fix is a one-line guard per platform, not a deletion.
Recounted: `matches` has 6 parameters on both platforms. detekt (LongParameterList, NavigationRules.kt:81) and swiftlint (function_parameter_count, NavigationRules.swift:78) both flag it at HEAD.

## B1-5: PLAUSIBLE
- Evidence: on WebView 146+ the spinner stops in the core's own NavigationListener: `pageFinished()` at
  MinimalWebViewClients.kt:72-75 and :80-84, plus the crash path at MinimalWebView.kt:374. The plan's seams S2 to S6
  (00-plan.md:80-82) have no load-end seam, so "core-size did not list" holds. "Hooks cannot see" is not proven:
  1. A hook client gets `onPageFinished` (fanned out at Clients.kt:137). On 146+ that misses only loads that never
     commit (Clients.kt:118-119).
  2. A hook gets the real WebView. androidx.webkit has an add/remove pair (`addNavigationListener` and
     `removeNavigationListener`, androidx-webkit-api.txt:643-665), and native-hooks.md:72-73 doesn't forbid adding one.
  Whether a second listener coexists with the core's needs a device: add one in sample-extension and check that both
  get `onNavigationCompleted`.
- Smallest change: the recommended document line in B1's decision packet, S. If a second listener works, write
  "a hook adds its own NavigationListener" there, not a new seam.
- Breaks: nothing (docs only).

## B2-04: CONFIRMED (part 3 is wider than stated, and its remedy is a guard, not a deletion)
- `activity`: only Kotlin has it (Hooks.kt:72, :111). The Swift protocol has nothing like it (Hooks.swift:50-70).
  native-hooks.md doesn't mention it, and nothing in the repo uses it: grep finds only the core's `owner.activity` in
  FullscreenVideo.kt:40, :86. A hook's own Expo module already has `appContext.currentActivity`.
- Detach reason: only Kotlin has it (Hooks.kt:31, :47; MinimalWebView.kt:276-277). It always repeats the
  `onDocumentEnd` that runs just before it:
  - `destroy()` calls `document.end(CLOSING)` and then `detachHooks()` (MinimalWebView.kt:413-414).
  - `processGone` calls `document.end(CRASHED)` and then `detachHooks()` (:360-361).
  - The hooks' handlers run inside `document.end` (:138).
  It is documented (native-hooks.md:26, :67), so it is redundant rather than accidental.
- Ask after close: confirmed on Android, and iOS has it too (see B4-04).
- Smallest change: delete `activity` (2 lines, S). Make Kotlin's detach `(() -> Unit)?` (Hooks.kt:31, :41, :47;
  MinimalWebView.kt:95, :276-277; native-hooks.md:26, :67; S). Fix the ask through B4-04.
- Breaks: the public Kotlin hooks API. A consumer reading `context.activity` switches to `appContext.currentActivity`
  (1 line). A detach lambda that takes `reason` drops the parameter and reads the reason in `onDocumentEnd` instead.
  sample-extension returns null (SampleExtensionModule.kt:29, :35, :39), so nothing in the repo or the suites breaks.

## B2-11: CONFIRMED
- Evidence: Hooks.kt:178 returns `declared !in BASES` whenever the declaring class isn't WebViewClientCompat. Take a
  plain WebViewClient that overrides only `shouldOverrideUrlLoading(WebView, String)`:
  - `getMethod(..., WebResourceRequest)` resolves to WebViewClient, which is in BASES, so `deciding()`
    (Clients.kt:96, :109) skips that client.
  - The core's rules decide instead, with no warning.
  - The platform's own forwarder would have called the hook's override.
  The same happens with `shouldInterceptRequest(WebView, String)` (Clients.kt:148), the 4-argument `onReceivedError`
  (:156) and `onConsoleMessage(String, Int, String)` (:341). A WebViewClientCompat subclass that overrides the
  deprecated `shouldInterceptRequest` also misses it. HooksTest.kt:36-57 covers only the compat variants, and
  native-hooks.md:50-51 documents only those.
- Smallest change: one line in native-hooks.md:50-51 saying that a plain client's deprecated variants don't count
  (S). The full fix is S too: key COMPAT_VARIANTS (Hooks.kt:157) by declaring class plus signature, add those 4
  entries, change :178-180 to look up the variant for any BASE, and add one HooksTest case (about 8 lines).
- Breaks: a hook that overrides a deprecated variant now takes that decision (its `shouldOverrideUrlLoading` turns
  the navigation rules off, as native-hooks.md:46-47 says). The existing HooksTest cases still hold (:55: PlainCompat's
  `(WebView, String)` is declared in WebViewClient). Nothing changes in the vectors or the suites.

## B3-11: CONFIRMED (keep)
- Evidence: the JVM tests use only junit and org.json, with no Robolectric (android/build.gradle:23-24). They cover the
  parts that are pure functions: the matcher with its vectors (NavigationRulesTest.kt), `crashAllowsReload`
  (MinimalWebView.kt:497), `showsSource` (:485), DocumentScope, `overrides()`, and client coverage
  (MinimalWebViewClientsTest.kt).
  - These run only on device (harness.ts:2484-2505: navigation, reissue, crash, bridge, ptr, fullscreen):
    `MinimalWebViewNavigation.decide`/`ask`/`reissue` (Navigation.kt:37-84), `processGone`/`recover`
    (MinimalWebView.kt:356-407), the transport (Scripts.kt:53-93), PullToRefresh.kt and FullscreenVideo.kt.
  - They depend on Chromium's callback order, as the comments at Clients.kt:58-75 and :115-119 show.
- Smallest change: none. Keep, size S.
- Breaks: nothing.

## B4-04: CONFIRMED (both platforms)
- Kotlin: `HookContext.ask` passes the ask to `view.ask`, then `askWithId`, which puts it in `pendingAsks`
  (Hooks.kt:121-122; MinimalWebView.kt:303-313). Nothing checks `destroyed`. `destroy()` fails the asks once, at
  :413. An ask made later (from a detacher at :414 and :277, an IO-thread hop at Hooks.kt:144-146, or any context a
  hook kept) is never answered. JS is unmounted. This contradicts Hooks.kt:87.
  - `private val view: MinimalWebView` is a strong reference (Hooks.kt:107). A context kept past `detachHooks`
    (MinimalWebView.kt:279) keeps the closed view and its destroyed WebView alive.
- Swift: `tearDown` fails the asks (MinimalWebView.swift:255-257), runs the detachers (:259) and sets `webView = nil`
  (:270). After that, the weak `view` still resolves until the view's deinit (Hooks.swift:76, :106-109), so
  `register` stores the ask (MinimalWebView+Navigation.swift:94-98).
  - At deinit, `tearDown` returns early at `guard let webView` (:254), so `onAnswer` is released without being called.
  - A detacher that asks also hits this. It contradicts native-hooks.md:54 and :70-71.
- Smallest change, S:
  - Kotlin, MinimalWebView.kt:303-305: `if (destroyed) onAnswer(null) else askWithId(...)`.
  - Swift, MinimalWebView.swift:486-488: `guard webView != nil else { return onAnswer(nil) }`.
  - native-hooks.md:70-71: drop "On iOS".
  - The weak reference in Kotlin (`WeakReference` in HookContext, about 6 lines) is optional. With the guard in place,
    a kept context costs only memory.
- Breaks: nothing in jest, the JVM tests or ios/Tests/main.swift (none touches asks). The sampleExtension suite never
  asks after close.

## B4-07: PLAUSIBLE (Android half confirmed, iOS half needs a device)
- Android 146+: `owner.url = navigation.url` runs before `newDocument()` (MinimalWebViewClients.kt:60-61), so
  `context.url` (Hooks.kt:112) is already the new page inside `onDocumentEnd(COMMITTED)`. Before 146, the end comes
  from `onPageStarted` (:122) and `url` from `doUpdateVisitedHistory` (:172), in an order Chromium decides.
- iOS: `url` is written only in `refreshUrls` (MinimalWebView.swift:281-291), which runs one main-queue turn after
  `scheduleUpdate` (:297-306). `didCommit` calls `document.end(.committed)` before it schedules a refresh (:390, :394),
  so `url` is whatever the last refresh saw. That is the ended page, unless WebKit's back-forward update and the
  earlier KVO refresh ran in an earlier turn than `didCommit`.
- Neither platform documents it: native-hooks.md:60-62 and Hooks.kt:74-75 and :93 don't say which URL.
- Settle it: emit `context.url` from sample-extension's `onDocumentEnd` (SampleExtensionModule.swift:19,
  SampleExtensionModule.kt:26-28) on both platforms.
- Smallest change: one line in native-hooks.md:60-62 (S). Or swap Clients.kt:60-61 so that Android 146+ reports the
  ended page (S). No core registrant reads `url` (MinimalWebView.kt:132-138).
- Breaks: only hooks that read `context.url` in `onDocumentEnd`. None in the repo. harness.ts:2174-2175 checks only
  that the event happened.

## B4-12: CONFIRMED
- Evidence: Kotlin `matches(rule, scheme, host, path, params, request)` (NavigationRules.kt:81) and the same 6 in
  Swift (NavigationRules.swift:78-79). Both tools report it.
- Smallest change, S: Kotlin's `parts()` already returns a Triple (:62). Make it a `Parts(scheme, host, path, params)`
  data class, so `matches(rule, parts, request)` has 3 parameters. Do the same with a private struct in Swift, built
  where :57-65 now compute it. A local function would also make it 1 parameter, but Swift's `match` (:41-71, 31 lines)
  would then pass the 40-line function_body_length limit.
- Breaks: nothing. The functions are private. NavigationRulesTest.kt and ios/Tests/main.swift call only `decide` and
  `answer`, and src/__tests__/vectors/navigation-rules.json doesn't change.

## B4-16: CONFIRMED
- Android: `reissue` loads with `loadUrl` (MinimalWebViewNavigation.kt:84, called from :73 and :163; `openFallback`
  does the same at :141). It relies on `loadUrl` not calling `shouldOverrideUrlLoading`: a reissued URL isn't a
  redirect, so it gets an empty `asked` set (:38) and would be asked again forever. That is written only at the
  callee, Clients.kt:106, and in passing at MinimalWebView+Navigation.swift:9-10, not at :66 or :84.
- iOS: `askedAndAllowed` applies to every navigation of the same frame kind (MinimalWebView+Navigation.swift:60-62,
  :72). Android's applies to redirects only (Navigation.kt:38). navigation-rules.md:35 states the difference but not
  why. The reason is that WKNavigationAction has no redirect flag (the SDK header has only
  `isContentRuleListRedirect`), and neither :58-59 nor the docs say so.
- Smallest change: one comment line at Navigation.kt:84 ("loadUrl skips shouldOverrideUrlLoading: the reissue isn't
  decided again") and one at MinimalWebView+Navigation.swift:58 ("WebKit doesn't flag redirects, so every
  navigation checks"). S.
- Breaks: nothing.

## B4-17: PLAUSIBLE
- Evidence: the listener is added with `context.mainExecutor` (MinimalWebView.kt:154). androidx's own overload also
  wraps a `Handler.post` (javap on webkit-1.17.1 `WebViewCompat.addNavigationListener`). So
  `onNavigationCompleted`, then `newDocument()`, then `scripts.documentEnded` (Scripts.kt:89-93) reach the main
  thread one hop after Chromium's commit.
  - The WebMessageListener (Scripts.kt:54-61) sets `replyProxy` on the new page's first post.
  - If that post (a head script's `call`, before DOMContentLoaded `ready`, pageClient.ts:62-71) ran first,
    `replyProxy = null` (:91) would drop the page's answers.
  - The late `navigated` would put JS back in `loading` after `ready` (createBridge.ts:126-135), so queued messages
    would wait for the next `ready`.
  Nothing written states the ordering. Whether Chromium's UI-thread task batching can run that IPC task ahead of the
  posted Message needs a device: a test page whose first `<head>` script calls the bridge on 146+.
- Smallest change: a 1-line comment at Scripts.kt:87-89 (S). If a device shows the reordering, a direct executor at
  MinimalWebView.kt:154 (`Runnable::run`, 1 line) removes the hop.
- Breaks: nothing for the comment. The executor change needs the bridge and bfcache suites rerun on API 37.

## B5-8: CONFIRMED (with two corrections)
- Evidence: what requests/*.kt use from `owner`, and what WebViewContext lacks:
  - the `core.` prefix: Downloads.kt:109, :141; FullscreenVideo.kt:83; FileUpload.kt:21; Permissions.kt:48. A hook
    can't use it (Hooks.kt:50, :119).
  - the request gate `requestHandlers`: Downloads.kt:42; FileUpload.kt:15; FullscreenVideo.kt:83; Permissions.kt:45.
  - an awaited `evaluate`: Downloads.kt:127.
  - a cancellable ask (`askWithId` and `cancelAsk`): Permissions.kt:33, :38, :48.
  - the download listener (S3), which a hook must not touch: MinimalWebView.kt:150-153; native-hooks.md:73.
  - With the chooser launcher (`module.openFileChooser`, Clients.kt:249-250), that makes 6.
  - Everything else is already there: `activity`, `emit`, `onDocumentEnd`, the WebView, and the decision and
    observation callbacks.
- Corrections:
  - The launcher belongs to ChromeClient's fallback, not to FileUpload.kt.
  - S4 is the iOS counterpart. iOS Downloads.swift:37, :56 also needs the gate and the `core.` prefix.
  - Calling `evaluate` core-only is a judgment call: consumers' `evaluateJavascript` can't await a promise either.
- Smallest change: the recommended note in docs/decisions.md on why the request classes take MinimalWebView (S).
- Breaks: nothing.

```json
[
 {"id":"B1-5","verdict":"PLAUSIBLE","evidence":"spinner stops in the core Listener (MinimalWebViewClients.kt:72-75,:80-84); S2-S6 have no load-end seam (00-plan.md:80-82); but hooks get onPageFinished (Clients.kt:137) and can call WebViewCompat.addNavigationListener (add/remove API); multi-listener needs a device check","smallest_change":"document in B1's packet; if a second listener works, say so instead of adding a seam","size":"S","breaks":"nothing"},
 {"id":"B2-04","verdict":"CONFIRMED","evidence":"activity Kotlin-only, undocumented, unused (Hooks.kt:72,:111); detach reason Kotlin-only and always equals the onDocumentEnd just before it (MinimalWebView.kt:360-361,:413-414,:138), documented (native-hooks.md:26,:67); ask-after-close is B4-04 and is on iOS too","smallest_change":"delete WebViewContext.activity; Kotlin detach becomes (() -> Unit)?; fix the ask with B4-04's guard","size":"S","breaks":"public Kotlin hooks API: context.activity -> appContext.currentActivity; detach lambdas drop the reason; sample-extension unaffected (returns null)"},
 {"id":"B2-11","verdict":"CONFIRMED","evidence":"Hooks.kt:178 treats a method declared in WebViewClient/WebChromeClient as not overridden, so a plain client overriding only the deprecated shouldOverrideUrlLoading(WebView,String), shouldInterceptRequest(WebView,String), onReceivedError(4 args) or onConsoleMessage(String,Int,String) is skipped by deciding/observing (Clients.kt:109,:148,:156,:341) without a warning; HooksTest.kt and native-hooks.md:50-51 cover only the compat variants","smallest_change":"doc line in native-hooks.md:50-51; full fix: key the variant table by declaring class, add 4 entries and 1 HooksTest case (~8 lines)","size":"S","breaks":"hooks overriding a deprecated variant now take that decision; existing HooksTest cases still pass"},
 {"id":"B3-11","verdict":"CONFIRMED","evidence":"JVM tests (junit+org.json only, android/build.gradle:23-24) cover only the pure pieces; Navigation.kt:37-84, MinimalWebView.kt:356-407, Scripts.kt:53-93, PullToRefresh.kt, FullscreenVideo.kt are covered only by on-device suites (harness.ts:2484-2505)","smallest_change":"none (keep)","size":"S","breaks":"nothing"},
 {"id":"B4-04","verdict":"CONFIRMED","evidence":"Kotlin: no destroyed check in ask (MinimalWebView.kt:303-313), asks failed once at :413, strong view ref (Hooks.kt:107); Swift: after tearDown the weak view still resolves, register stores the ask (+Navigation.swift:94-98), deinit's tearDown returns at :254 so onAnswer is dropped; contradicts Hooks.kt:87 and native-hooks.md:54,:70-71","smallest_change":"Kotlin MinimalWebView.ask: if (destroyed) onAnswer(null); Swift MinimalWebView.ask: guard webView != nil else onAnswer(nil); drop 'On iOS' at native-hooks.md:70; WeakReference optional","size":"S","breaks":"nothing tested; docs line 70-71"},
 {"id":"B4-07","verdict":"PLAUSIBLE","evidence":"Android 146+: url set before newDocument (Clients.kt:60-61), so context.url is the new page; iOS: url only updated in the async refreshUrls (MinimalWebView.swift:281-306) after document.end at :390, so likely the ended page but this depends on WebKit's IPC turns; neither platform documents it (native-hooks.md:60-62)","smallest_change":"one doc line in native-hooks.md:60-62, or swap Clients.kt:60-61 (no core registrant reads url)","size":"S","breaks":"only hooks reading context.url in onDocumentEnd; none in the repo; harness.ts:2174 unaffected"},
 {"id":"B4-12","verdict":"CONFIRMED","evidence":"6 params at NavigationRules.kt:81 and NavigationRules.swift:78-79; detekt LongParameterList and swiftlint function_parameter_count both report it","smallest_change":"Parts(scheme,host,path,params) replacing Kotlin's Triple (:62) and a private Swift struct; matches(rule, parts, request)","size":"S","breaks":"nothing (private); vectors and both test files unchanged"},
 {"id":"B4-16","verdict":"CONFIRMED","evidence":"reissue (Navigation.kt:84, callers :73,:163; also :141) relies on loadUrl skipping shouldOverrideUrlLoading, otherwise a non-redirect re-ask loops (:38); written only at Clients.kt:106 (and +Navigation.swift:9-10); iOS ask cache covers all navigations (+Navigation.swift:60-62) because WKNavigationAction has no redirect flag, which is not stated","smallest_change":"one comment at Navigation.kt:84 and one at +Navigation.swift:58","size":"S","breaks":"nothing"},
 {"id":"B4-17","verdict":"PLAUSIBLE","evidence":"listener delivered via Handler post (MinimalWebView.kt:154; androidx's overload also posts); if the new page's first bridge post ran first, documentEnded (Scripts.kt:89-93) would null its replyProxy and send navigated after ready (createBridge.ts:126-135); the ordering is not written anywhere and needs a device","smallest_change":"1-line comment at Scripts.kt:87-89; if a device shows reordering, a direct executor at MinimalWebView.kt:154","size":"S","breaks":"nothing for the comment; executor change needs the bridge/bfcache suites on API 37"},
 {"id":"B5-8","verdict":"CONFIRMED","evidence":"requests/*.kt need core. prefix, requestHandlers gate, awaited evaluate (Downloads.kt:127), askWithId/cancelAsk (Permissions.kt:33,:38,:48), the download listener (S3, MinimalWebView.kt:150-153) and the chooser launcher (Clients.kt:249-250, ChromeClient not FileUpload) = 6; S4 is the iOS counterpart (Downloads.swift:37,:56)","smallest_change":"note in docs/decisions.md","size":"S","breaks":"nothing"}
]
```
