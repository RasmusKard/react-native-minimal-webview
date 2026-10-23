# C1 verification: android-requests-settings (13 findings, HEAD 8c0c1ca)

CONFIRMED 12 (B2-01, B3-03, B3-04, B3-07, B4-01, B4-02, B4-03, B4-08, B4-09, B4-10, B4-11, B5-10), PLAUSIBLE 1 (B1-7), REFUTED 0.
Smaller changes than recommended: B4-08 (Swift needs only the hook move), B4-09 (no Swift change), B4-11 (one line instead of an extraction). B4-02's install() sub-claim is wrong as worded.
Measured with detekt and swiftlint on temp copies (`mktemp -d`); the repo itself was not touched. Thresholds: detekt.yml:4-6, .swiftlint.yml:6-7. detekt flags a value equal to the threshold (definition 15/15 is flagged).

## B1-7: PLAUSIBLE. Replacing OkHttp with HttpURLConnection plus CookieManager
- Holds: android/build.gradle:22 and Downloads.kt:7,10-12 are the only places in android/ that use `com.facebook.react` or `okhttp3` (grep over *.kt, *.gradle, *.pro, *.xml).
- Not proven: that dropping the dependency still compiles. MinimalWebView extends ExpoView, and ExpoView exposes `var stateWrapper: StateWrapper?` and calls `BackgroundStyleApplicator`
  (example/node_modules/expo-modules-core/android/src/main/java/expo/modules/kotlin/views/ExpoView.kt:7-8,19). expo-modules-core declares react-android
  only as `implementation` (expo-modules-core/android/build.gradle:317), and the Expo gradle plugin adds only modules-core, as compileOnly
  (expo-module-gradle-plugin/.../ProjectConfiguration.kt:71). The two Expo modules here that build without react-android (expo-constants,
  expo-keep-awake) define no view. What would settle it: delete the line and run `:minimal-rn-webview:compileDebugKotlin`. Dropping it also doesn't make the app smaller: every RN app ships react-android and OkHttp.
- What the swap would need, feature by feature: (1) cookies: on every hop, `CookieManager.getCookie(url)` goes into the `Cookie` header and each `Set-Cookie` goes to `setCookie(url, it)`.
  This is what ForwardingCookieHandler does (react-native/.../ForwardingCookieHandler.kt:29-63; it also calls flush, which the module already does at
  background, MinimalWebViewModule.kt:68-69). (2) redirects: `instanceFollowRedirects = false` plus a manual loop. The loop is needed because cookies must be read and stored on each hop, and
  `CookieHandler.setDefault` would apply to the whole app. It needs a hop limit (OkHttp's is 20), `URL(current, location)` for relative Locations, `disconnect()` on each hop, and the https-to-http check.
  (3) caps: `contentLengthLong` replaces `body.contentLength()` (Downloads.kt:59), the copy loop stays as it is (62-70), `responseCode in 200..299` replaces `isSuccessful` (57),
  and the MIME type is read from `getHeaderField("Content-Type")` (73). (4) timeouts: set `connectTimeout`/`readTimeout` on each connection (165-166).
  A sketch counts about 19 lines plus 2 constants in place of the 11-line client (162-172), and 3 imports in place of 4, so +8 to +10 lines. The finding's estimate holds.
- Behavior change: today's interceptor compares each hop with the original request (Downloads.kt:168), so http→https→http is allowed. A check
  per hop would refuse that.
- Testable on the JVM only if the cookie read and write are passed in: `CookieManager.getInstance()` throws "not mocked" on the JVM, because
  android/build.gradle:9-15 doesn't set `returnDefaultValues`. The OkHttp client is already testable the same way if it takes a `java.net.CookieHandler`, so the
  testability gain is not specific to HttpURLConnection. Peer `react-native >=0.79` (package.json:79): whether 0.79 has the no-argument
  `ForwardingCookieHandler()` that Downloads.kt:164 calls is unchecked. 0.88 has it (ForwardingCookieHandler.kt:23).
- Smallest change: as recommended, M. Breaks: the downloads suite's cross-host redirect and cookie checks (example/harness.ts:1863,1888-1892;
  example/test-pages/server.js:282-283) must keep passing. nativeContract.test.ts:168-171 parses the `"core.download",` call sites, which the swap doesn't touch. No consumer-facing change.

## B2-01: CONFIRMED. `ref.hook` during an Android rebuild rejects `hook_not_handled`
- processGone → detachHooks empties `hookContexts` (MinimalWebView.kt:361,279). Until recover() (398) runs, `hookHandler` (299) returns null and
  the module rejects `hook_not_handled` (MinimalWebViewModule.kt:149-150). The `recovering` check in `native()` (168-170) runs only on the reply path.
- props.md:31-33 lists `hook` among the methods that reject `unavailable` while the WebView is rebuilt, and types.ts:256-257 says the same without naming a method.
- Smallest change, S: one line before MinimalWebViewModule.kt:149, `if (view.recovering) return@AsyncFunction promise.reject("unavailable", RECOVERING, null)`.
  Breaks nothing (no test or suite calls hook during recovery). For consumers: code that caught `hook_not_handled` in this window now gets `unavailable`, which is what the docs say.

## B3-03: CONFIRMED. coerce, set and arguments have no laptop test
- No JVM test mentions PlatformSettings (android/src/test has 6 files, none of them about it). The settings code is tested only by the on-device suites.
- The number is coerce's alone: coerce 24, set 13, arguments 8 (detekt, measured). None of the three reads `owner`.
  set calls arguments, invoke and problem (PlatformSettings.kt:117-119,161-170), so those move too, and `Target` (32) changes from private to internal.
  The companion (172) is already internal. The production change is a relocation, about 0 lines. A test can pass `Target(Fake::class.java, fake, null)`.
- Smallest change: as recommended, S, plus one test file. Breaks nothing. MinimalWebViewModule.kt:152 already calls `PlatformSettings.toJson`.

## B3-04: CONFIRMED. fetch's failure paths are tested on no layer
- No JVM test covers Downloads. The downloads suite covers attachment, blob, data, an http→http cross-host redirect and the blob cap, which is enforced in JS
  (harness.ts:1858-1922; Downloads.kt:122). The errors suite covers a bad data: URL (harness.ts:2305-2317). Non-2xx (Downloads.kt:57), both fetch caps (59, 68),
  the MIME fallback (73) and the https-to-http refusal (168) are never exercised, and no check reads `mimeType`.
- A `fetchTo(download, file): String` in the companion (the body of the lambda at 55-73) can be tested on the JVM against the JDK's `com.sun.net.httpserver`, with no new dependency.
  This works because ForwardingCookieHandler swallows the CookieManager failure (ForwardingCookieHandler.kt:72-92). The streamed cap needs over 100 MB of traffic unless the cap is
  a parameter. The https-to-http refusal needs a trusted TLS server, which the fixed client (162) can't be given, so it can't be tested this way unless the interceptor is extracted.
- Smallest change: as recommended, S (about +2 lines plus a test). Breaks nothing, as long as the `"core.download",` call sites stay put (nativeContract.test.ts:168-171).

## B3-07: CONFIRMED. Three rules live only in comments, and the docs contradict the code on the crash guard
- The https-to-http refusal appears only at Downloads.kt:159-160; page-requests.md:28-37 doesn't mention it.
- The app-wide one-at-a-time file chooser, which stays cancelled until the app restarts if no result comes back, appears only at MinimalWebViewModule.kt:36-39,61. page-requests.md:9 doesn't mention it.
- Crash guard: on Android only retry() clears `crashTimes` (MinimalWebView.kt:232-239), and loadNewSource doesn't (197-203). iOS also resets on a new source
  (ios/MinimalWebView.swift:128-129). props.md:18 and glossary.md:49 say "source change or reload()" with no platform split. CHANGELOG.md:45
  already states the Android rule correctly.
- Smallest change, S: props.md:18 and glossary.md:49 become "until the next `reload()` (on iOS also a `source` change)", and page-requests.md gets one
  sentence each on the redirect refusal and the chooser. Docs only. The code comment at MinimalWebView.kt:233-234 argues against changing the code.

## B4-01: CONFIRMED. Download events are posted with View.post
- Downloads.kt:106 reads `owner.webView` inside `io.execute` (94-115), so on the IO thread, and `current` is a plain var written on main (MinimalWebView.kt:44,398).
  During recovery `current` is the dead WebView, which was removed from its parent and destroyed (362-367) and is never attached again. View.post queues the event on that view's run
  queue, so the event is lost. While the view is detached, the event waits until it is attached again. MinimalWebView.kt:123-125 states this exact rule and adds `mainHandler` for that reason.
  Downloads.kt:106 is the package's only View.post.
- Smallest change, S: `owner.webView.post {` → `owner.mainHandler.post {` (one line). Breaks nothing. After destroy the event is dropped either way.

## B4-02: CONFIRMED, except the install() part. The recovery window
- The rule (during recovery, `webView` is the destroyed one) is written at MinimalWebView.kt:118,183,382, not at the entry points that rely on it.
- hook: as B2-01. optionsChanged: with `hookContexts` empty (279), a key in `hookKeys` that goes from off to on during the window warns "added after the WebView was created"
  (292-293). But recover() attaches it (142-143), and the new HookContext reads the current options (Hooks.kt:109). The window is narrow but real.
- navigate: back, forward and stop reach the dead WebView (MinimalWebViewModule.kt:127,128,130), and so does emitState's `canGoBack` (MinimalWebView.kt:446, via 377).
  Chromium ignores calls on a destroyed WebView, but WebView.destroy's contract forbids them.
- install(): the claim is wrong as worded. It runs only from setUp (214), which applyProps blocks during recovery (184), and recover() calls it only after building the new WebView (398-399).
  The only thing it does to the dead WebView is `scriptHandlers.forEach { it.remove() }` (Scripts.kt:71), which removes the dead WebView's handlers. Whether that is harmless needs a
  device run with `injectedScripts` set across a crash. The crash suite sets none (harness.ts:1047-1080).
- Smallest change, S, about 4 lines: the B2-01 line; at :292 `else if (key !in hookKeys.orEmpty() && …)`; `if (view.recovering && action != "reload") return@AsyncFunction`
  in navigate; `scriptHandlers.clear()` at the start of install(). Breaks nothing: no test covers these paths.

## B4-03: CONFIRMED. `ref.hook` never settles when the handler never replies
- The handler gets `reply` and nothing else ever settles the promise (MinimalWebViewModule.kt:152; ios/MinimalWebViewModule.swift:58-68). It stays open past the Document's end, a crash
  and teardown. JS doesn't track the promise either (src/WebView.tsx:286-287). By contrast, asks settle (MinimalWebView.kt:136,345), evaluate settles (Scripts.kt:89-90,129-133),
  and the bridge settles (JS rejects in-flight calls at unmount, Scripts.kt:87-88). The docs only say "call `reply` once" (native-hooks.md:55-57).
- Smallest change, S: one sentence at native-hooks.md:56, e.g. "a handler that never replies leaves the promise pending: nothing settles it at the Document's end, a
  crash or unmount". It covers both platforms. A code fix that settles it at the Document's end would be M. Breaks nothing.

## B4-08: CONFIRMED. The module definitions are over the limits
- Recounted: Kotlin `definition` has LongMethod 77/60, cyclomatic 15/15 and cognitive 19/15 (MinimalWebViewModule.kt:57). The Swift body is 62/60 lines (ios/MinimalWebViewModule.swift:5).
- Measured on a temp copy with the navigate, hook and warmUp bodies moved to private functions: `definition` is 57 lines, cyclomatic 8, cognitive 10. Each move saves
  6 to 10 lines and 57 leaves a margin of 3, so Kotlin needs all three. Swift has no warmUp; moving only the hook body (lines 59-68) gets to about 53.
- Smallest change, S: Kotlin as recommended; Swift only the hook move. Breaks nothing. nativeContract.test.ts:35 reads `AsyncFunction("name")`, and those calls stay in the definition.

## B4-09: CONFIRMED for Kotlin. No Swift change is needed
- Measured. Kotlin coerce today: 24. With ignoreSimpleWhenEntries alone: 15 (still flagged). With the type boxed alone, as one subject `when (type.kotlin.javaObjectType)`: 18.
  With both: 12, below the limit. So the finding's two Kotlin steps are both needed, and they are enough. The behavior is the same, because a Boolean never passes `as? Number` or `as? String`.
- Swift coerce (ios/PlatformSettings.swift:143) is 19 with case statements counted and 4 under the repo's `ignores_case_statements: true` (.swiftlint.yml:6). That setting is the
  Swift counterpart of ignoreSimpleWhenEntries, so a `doubles()` helper only shortens the long guards at 169 and 178; it doesn't affect a threshold.
- Smallest change, S: Kotlin's coerce rewrite plus one detekt.yml key. It can only lower other functions' counts (targets goes from 6 to 2). Breaks nothing.

## B4-10: CONFIRMED. fetch's cognitive complexity of 23
- Measured with the copy loop (Downloads.kt:60-72) extracted as `copyCapped(input, output)`: fetch has cognitive 6 and cyclomatic 8, copyCapped has cognitive 5. That is as recommended, S, +3 lines.
- Put it in the companion with the cap as a parameter and it also covers part of B3-04: the streamed cap can then be tested with ByteArrayInputStream. Breaks nothing.

## B4-11: CONFIRMED. `apply` is at 16/15 cyclomatic and 15/15 cognitive. A one-line change is enough
- Measured. Extracting the inner loop (44-51): apply 8/9, applyRoot 9/4, +12 lines. Smaller: at PlatformSettings.kt:39,
  `val targets = targets(rootName)?.takeIf { rootName in listOf("settings", "webView") }` gives apply 14/11, 0 lines. It calls `targets()` for the cookieManager and
  webStorage roots before rejecting them. That is harmless because a WebView exists when apply runs, so `CookieManager.getInstance()` costs nothing. The margin is 1.
- Size S. Breaks nothing (no test covers apply).

## B5-10: CONFIRMED that both should be kept, but the stated reason is inaccurate
- PageRequestHost: the request classes use only a few owner members (Permissions.kt:33,38,45,47,48; FileUpload.kt:15,21). The android.webkit types are not the blocker:
  GeolocationPermissions.Callback and ValueCallback are interfaces, and PermissionRequest and FileChooserParams are abstract classes. The blocker is `android.net.Uri.parse`
  (Permissions.kt:58, FileUpload.kt:22), which throws "not mocked" on the JVM, plus View, Window and Activity in FullscreenVideo.kt:33-46. As the code stands, the seam
  buys no JVM test. If `originOf` used `java.net.URI`, it would make the origin check, which is security code (plan section 2), testable on the JVM. That is the maintainer's call.
- NavigationState holder: about 20 writes in MinimalWebViewClients.kt (47-66, 73-82, 123-133, 172, 185, 285, 291) would become `owner.state.x`. The one reader,
  emitState (MinimalWebView.kt:438-453), stays where it is, so no jump is removed. Recommendation `keep`, size S (nothing to do). Breaks nothing.

```json
[
 {"id":"B1-7","verdict":"PLAUSIBLE","evidence":"Only Downloads.kt:7,10-12 and build.gradle:22 use react-android/OkHttp; HttpURLConnection sketch is +8 to +10 lines; unproven: compiling without react-android (ExpoView.kt:7-8,19 exposes StateWrapper; modules-core has it as implementation only, build.gradle:317); JVM-testable only with injected cookie functions","smallest_change":"as recommended; first delete the line and compile :minimal-rn-webview:compileDebugKotlin to settle it","size":"M","breaks":"harness downloads 'moved' and cookie checks (harness.ts:1863,1888) must pass; per-hop https check refuses http->https->http that Downloads.kt:168 allows; no consumer API change"},
 {"id":"B2-01","verdict":"CONFIRMED","evidence":"detachHooks empties hookContexts (MinimalWebView.kt:279,361); hook rejects hook_not_handled (MinimalWebViewModule.kt:149-150); props.md:31-33 promises unavailable","smallest_change":"if (view.recovering) reject unavailable before MinimalWebViewModule.kt:149","size":"S","breaks":"nothing tested; consumers see unavailable instead of hook_not_handled in the window"},
 {"id":"B3-03","verdict":"CONFIRMED","evidence":"no JVM test of PlatformSettings; 24 is coerce alone (set 13, arguments 8); set/arguments/coerce/invoke/problem don't use owner (PlatformSettings.kt:108-170)","smallest_change":"move them and Target (internal) into the companion, add one JVM test with a fake class","size":"S","breaks":"nothing"},
 {"id":"B3-04","verdict":"CONFIRMED","evidence":"harness.ts:1858-1922 and 2305-2317 cover none of Downloads.kt:57,59,68,73,168; no JVM test","smallest_change":"fetchTo in the companion + JDK HttpServer test; https->http needs the interceptor extracted","size":"S","breaks":"keep the \"core.download\", call sites (nativeContract.test.ts:168-171)"},
 {"id":"B3-07","verdict":"CONFIRMED","evidence":"Downloads.kt:159-160 and MinimalWebViewModule.kt:36-39,61 undocumented; Android resets the guard only in retry (MinimalWebView.kt:232-239), iOS on source too (MinimalWebView.swift:128-129); props.md:18, glossary.md:49 say source change; CHANGELOG.md:45 is right","smallest_change":"split props.md:18 and glossary.md:49 per platform; one sentence each in page-requests.md","size":"S","breaks":"docs only"},
 {"id":"B4-01","verdict":"CONFIRMED","evidence":"Downloads.kt:106 View.post read on the IO thread; dead WebView removed and destroyed (MinimalWebView.kt:362-367) never re-attaches; MinimalWebView.kt:123-125 states the rule","smallest_change":"owner.mainHandler.post at Downloads.kt:106","size":"S","breaks":"nothing"},
 {"id":"B4-02","verdict":"CONFIRMED","evidence":"hook (as B2-01); wrong warning at MinimalWebView.kt:292-293 for a hookKeys key during recovery; navigate reaches dead WebView (MinimalWebViewModule.kt:127-130), canGoBack (MinimalWebView.kt:446); install() runs only on the new WebView (184,398-399), only Scripts.kt:71 removes the dead WebView's handlers (effect needs a device)","smallest_change":"B2-01 line; key !in hookKeys at :292; recovering guard in navigate; scriptHandlers.clear() at install start","size":"S","breaks":"nothing tested"},
 {"id":"B4-03","verdict":"CONFIRMED","evidence":"MinimalWebViewModule.kt:152 and ios/MinimalWebViewModule.swift:58-68 settle only via reply; asks (MinimalWebView.kt:345) and evaluate (Scripts.kt:89-90) settle at the Document's end; native-hooks.md:55-57 silent","smallest_change":"one sentence at native-hooks.md:56","size":"S","breaks":"docs only"},
 {"id":"B4-08","verdict":"CONFIRMED","evidence":"detekt 77/60, 15/15, 19/15 (MinimalWebViewModule.kt:57); swiftlint 62/60 (ios/MinimalWebViewModule.swift:5); measured after the three moves: 57 lines, 8, 10","smallest_change":"Kotlin: all three moves (needed); Swift: only the hook body","size":"S","breaks":"nothing; nativeContract.test.ts:35 still finds the AsyncFunction names"},
 {"id":"B4-09","verdict":"CONFIRMED","evidence":"measured Kotlin coerce 24; config alone 15, boxing alone 18, both 12; Swift 19 raw, 4 under .swiftlint.yml:6","smallest_change":"Kotlin boxed when + ignoreSimpleWhenEntries; no Swift change","size":"S","breaks":"nothing; the config only lowers other counts"},
 {"id":"B4-10","verdict":"CONFIRMED","evidence":"detekt cognitive 23 (Downloads.kt:53); measured after extraction fetch 6, copyCapped 5","smallest_change":"as recommended; put copyCapped in the companion with the cap as a parameter to serve B3-04","size":"S","breaks":"nothing"},
 {"id":"B4-11","verdict":"CONFIRMED","evidence":"detekt 16/15, 15/15 (PlatformSettings.kt:35); measured: one-line takeIf at :39 gives 14/11; extraction gives 8/9","smallest_change":"targets(rootName)?.takeIf { rootName in listOf(\"settings\", \"webView\") } at PlatformSettings.kt:39","size":"S","breaks":"nothing"},
 {"id":"B5-10","verdict":"CONFIRMED","evidence":"the JVM blocker is Uri.parse (Permissions.kt:58, FileUpload.kt:22) and View APIs (FullscreenVideo.kt:33-46), not android.webkit types (interfaces and abstract classes); the state holder keeps one reader (MinimalWebView.kt:438-453)","smallest_change":"keep; optionally java.net.URI in originOf would make the origin check JVM-testable (maintainer)","size":"S","breaks":"nothing"}
]
```
