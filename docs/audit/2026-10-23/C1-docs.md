# C1 verification: docs group (12 findings) @ 8c0c1ca

CONFIRMED 11 (B1-1, B2-05 narrowed, B2-06, B2-09, B2-14, B3-01, B3-02, B3-06, B3-10, B4-18, B5-2), PLAUSIBLE 1 (B2-17), REFUTED 0.
Cross-confirmed: B2-09 and B3-06 are one defect; the repo's device notes resolve it toward "onPageStarted fires at commit" (props.md:67, harness.ts:1149-1150).
Plan §2's "Open" note says the Document-scope question is "not claimed in user docs"; it is (props.md:16, :67). C2 should correct that.

## B1-1: CONFIRMED (keep)
- The letters in A2-features.md:21-40 are core-size.md's classes (A2-features.md:17: (a) must be core, (b) built-in
  optional extension, (c) recipe on today's seams, (d) needs a missing seam), not plan §1's reasons. Read under §1:
  the (b)+(d) rows (shared cookies, Android pull-to-refresh, download saving) can't move until S2-S5 exist: there is no container,
  download listener or reload on the contexts (Hooks.kt:69-101, Hooks.swift:50-70). That is §1 reason (c), and the moves are deferred (plan §2).
- The one row PR #36 made a full (c), iOS pull-to-refresh, is about 10 lines (MinimalWebView.swift:24-27, :109, :122-123, :415).
  A consumer would need a whole Expo module to replace it (plan §0's consumer-cost rule), so it is still §1 (c). The other (c) rows are kept (plan §2).
- Not checkable statically: "Other core" (565 lines, A2-features.md:40) has no breakdown.
- Smallest change: none. Breaks: nothing.

## B2-05: CONFIRMED, narrowed
- Confirmed: `uiDelegates` (Hooks.swift:58), `chromeClients` (Hooks.kt:82) and Android's `context.activity` (Hooks.kt:72)
  appear in no doc. docs/ only shows `navigationDelegates` (native-hooks.md:14) and `clients` (:25). The sample uses
  the other two (SampleExtensionModule.swift:29, SampleExtensionModule.kt:38).
- Refuted in part: most platform-made differences are written down, though not in one list. `configure`'s argument
  (native-hooks.md:63-66), the detach closure's reason (:67), the re-attach after a crash (:42, :67-68), the dead iOS context (:70-71)
  and the first-delegate-only observation callbacks (:48-49) are all covered. Not written: Android posts a hook's `emit`/`ask` from another
  thread onto main (Hooks.kt:143-146), while iOS does not.
- Smallest change (S), native-hooks.md:43: "- **Delegates and clients.** Add yours to the context's lists, in order:
  `navigationDelegates` and `uiDelegates` (iOS), `clients` and `chromeClients` (Android). A callback that returns a
  decision goes to …". Append to :62: "On Android, `context.activity` is the current `Activity`, or null."
- Breaks: nothing.

## B2-06: CONFIRMED
- iOS clears the guard on a new `source` (MinimalWebView.swift:128-129) and on `retry()` (:192-194). Android clears it
  only in `retry()` (MinimalWebView.kt:236-238), by design (:233-234: the count is per process). CHANGELOG.md:44-45
  already says this; props.md:18 and glossary.md:49 don't.
- Smallest change (S). props.md:18: "…it stops reloading, until the next `reload()` (on iOS also the next `source`
  change)." glossary.md:49: "…until the next `reload()` (on iOS also a `source` change)."
- Breaks: the check 'a new source resets the crash-loop guard' (harness.ts:1193) runs on both platforms right after
  `reload()` (harness.ts:1177), so `reload()` has already cleared the guard. The check proves nothing about `source` on
  either platform. Rename it ('a crash after reload() and a new source recovers'), or test iOS alone.

## B2-09: CONFIRMED
- The disagreement is real. props.md:16 and :67 say a pre-146 load that never commits fires no load event.
  decisions.md:30-31 says it "ends the Document spuriously". MinimalWebViewClients.kt:116-117 says that too, and
  :118-119 says the opposite.
- The device evidence points to "at commit". Before 146 the file chooser is cancelled only when the Document ends
  (MinimalWebView.kt:132; the `onNavigationStarted` cancel at Clients.kt:46 needs WebView 146), and on that path the
  Document ends only through `newDocument()` in `onPageStarted` (Clients.kt:122). props.md:67 says the chooser was seen
  cancelled "only when the next page commits" on WebView 133. harness.ts:1149-1150, written for PR #40 (4d9d722), says
  "Before WebView 146 the load starts at commit".
- How to settle it: run urlTracking on mrw-api36. The INFO lines carry `ok` and `detail` (harness.ts:240-241), and
  `stopped` should be undefined.
- Smallest change (S, doc and comment). decisions.md:30-31: "Before WebView 146, Android has no commit callback, so
  `onPageStarted` stays the commit signal; Chromium calls it at commit (seen on WebView 133), so a load that never
  commits neither ends the Document nor fires load events." Keep the `onPageCommitVisible` sentence. Delete
  Clients.kt:116-117 (the `shortcut:` line). The "test" recommendation is M: give `checkUnlessOldWebView`
  (harness.ts:222) an expected old-WebView value, so harness.ts:923-958 and :1869-1876 assert "no outcome" below 146
  instead of reporting INFO.
- Breaks: plan §2's "Open" item becomes a doc fix, and the maintainer should confirm it.

## B2-14: CONFIRMED
- glossary.md:28-29 says an Ask's payload "is a `…Request`", and CHANGELOG.md:11 says the same. A hook's ask arrives as
  `HookEvent` (types.ts:245, :305), the type `emit` also uses. glossary.md:36 says a "told afterwards" prop gets a
  `…Event`, but `onDownload` gets `Download | DownloadFailure` (types.ts:188, :200, :345).
- When no handler exists, the bridge uses `not_found` (protocol.ts:5, endpoint.ts:109) and `ref.hook` uses
  `hook_not_handled` (types.ts:260, MinimalWebViewModule.swift:60, MinimalWebViewModule.kt:150). These are two separate
  code sets (`BridgeErrorCode`, `WebViewErrorCode`), both lowercase, and no doc says they are shared. That is a fact,
  not a drift.
- Smallest change (S). glossary.md:29: "payload type is a `…Request` (a hook's ask is a `HookEvent`, like its `emit`)".
  glossary.md:36: "…is told afterwards (a `…Event`; `onDownload` gets a `Download` or `DownloadFailure`)". The same
  exception goes in CHANGELOG.md:11. Leave the error codes.
- Breaks: nothing. Renaming the types instead would change types.ts, the tests, the harness and the docs; that is the
  maintainer's call.

## B2-17: PLAUSIBLE
- The docs disagree. navigation-rules.md:44-45 decides a reload's or back/forward's redirect "on Android" only, while
  migrating-from-react-native-webview.md:210-211 says "(their redirects don't)" and names no platform. The code agrees
  with navigation-rules.md. iOS skips every action whose `navigationType` is `.reload` or `.backForward`
  (MinimalWebView+Navigation.swift:14). Android's `shouldOverrideUrlLoading` runs again for redirects
  (MinimalWebViewClients.kt:106).
- Not provable statically: whether WebKit keeps `.reload` on a reload's server redirect. No suite covers it; every
  harness redirect is page-initiated (harness.ts:401, :949, :990).
- How to settle it (M): a test-pages route that redirects only on its second request, like `/moved?key=`
  (server.js:6), then a block rule on the target and `reload()`, on both platforms.
- Smallest doc change (S), migrating:210-211: "…skip the rules; a redirect of the `source` load doesn't (on Android,
  nor does a reload's or back/forward's redirect)."
- Breaks: nothing.

## B3-01: CONFIRMED
- development.md:26 says "CI fails when either is stale". The `--check` runs exist only in CI (test.yml:22-23), and
  CI is off (plan §0). No command in development.md:3-13 runs them, and package.json has no check script.
- I ran both checks locally at HEAD (read-only): both pass, and `gen:platform-types -- --check` needs no SDK.
- Smallest change (S). Add a line to development.md:3-13: `node .github/scripts/build-page-client.mjs --check && npm
  run gen:platform-types -- --check   # the generated files match their sources`. Line 26 becomes: "Two files are
  generated; the `--check` line above fails when either is stale:".
- Optional, also S: one `"check"` script in package.json that chains lint, the type-checks, both `--check` runs,
  `npm test` and `prepare`.
- Breaks: nothing. .github/workflows stays untouched.

## B3-02: CONFIRMED (Periphery's count not re-run)
- detekt shows 9 smells and exits 2 ("Analysis failed with 9 weighted issues"). SwiftLint shows 5 (2 errors, 3
  warnings) and exits 2. ESLint shows 26 warnings and 0 errors. The installed detekt 1.23.8, SwiftLint 0.65.1 and
  Periphery 3.8.0 each have a baseline flag (`--create-baseline`/`--baseline`; `--write-baseline`/`--baseline` for the
  other two). ESLint has `--max-warnings`.
- development.md:15 calls these "reports rather than checks", so nothing stops a new finding.
- Smallest change (S). Write each baseline once. Add `--baseline <file>` to development.md:19-21. Set
  `"lint": "eslint --max-warnings 26 src example .github"`. development.md:15 becomes: "The code's shape, ratcheted:
  each tool fails on a finding its baseline doesn't list; rewrite the baseline after a fix."
- Breaks: `npm run lint` fails above 26 warnings. Baseline or raise the thresholds is the D-packet decision (plan §6).

## B3-06: CONFIRMED (same defect as B2-09)
- The split is as claimed: decisions.md:30-31 and Clients.kt:116-117 against Clients.kt:118-119, props.md:16 and
  harness.ts:1869 (also props.md:67, harness.ts:922 and :1149-1150).
- Smallest change and what breaks: as in B2-09.

## B3-10: CONFIRMED
- No AVD command: development.md:83 names `mrw-api37`/`mrw-api36` but says nothing on how to make them. The local AVDs
  (~/.android/avd/*/config.ini) are `system-images;android-37.1;google_apis_ps16k;arm64-v8a` and
  `system-images;android-36;google_apis;arm64-v8a`, both on device `pixel_9_pro`. So :83's "API 37" is really 37.1,
  with 16 KB pages.
- No reference iOS simulator: :63 says `<simulator udid>`, and no repo file names a model or runtime.
- No sample-extension compile: no laptop command builds example/modules/sample-extension without an app build, not
  even CI's kotlin.yml:37.
- :10's list leaves out ShowsSourceTest (android/src/test/.../ShowsSourceTest.kt).
- Smallest change (S).
  - :10: append ", showsSource" to the comment.
  - After :86: `sdkmanager 'system-images;android-37.1;google_apis_ps16k;arm64-v8a' && avdmanager create avd -n
    mrw-api37 -k 'system-images;android-37.1;google_apis_ps16k;arm64-v8a' -d pixel_9_pro`, and the same for api36.
  - :83: "(Google APIs, 16 KB pages, API 37.1, WebView 149)".
  - The block at :3-13: `(cd example/android && ./gradlew :sample-extension:compileDebugKotlin)   # the sample hooks against the hook API`.
    The project name is inferred from example/modules/sample-extension/package.json:2 and was not run (no gradle here).
  - The iOS simulator: only the maintainer can name it.
- Breaks: nothing.

## B4-18: CONFIRMED
- Android saves history only when the page on screen is not the source and the reload goes ahead
  (MinimalWebView.kt:364-365). Otherwise recover() reloads the source in a new WebView with no history
  (:403-404, `loadAgain` :228). The second case also covers a reload held back by the guard or a POST: the app's later
  `reload()` loads without history.
- Three docs claim the history always comes back: props.md:18, glossary.md:47-48 and CHANGELOG.md:45.
- Smallest change (S). props.md:18: "Android builds a new WebView with the back/forward history restored, unless the
  page on screen is the `source` or the reload was held back (then the page loads again with no history), and not
  before …". glossary.md:48: "(on Android in a new WebView, with the history restored unless the `source` page is on
  screen)". CHANGELOG.md:45: the same qualifier.
- Breaks: nothing. The crash suite only checks history for a non-source page (harness.ts:1095-1096).

## B5-2: CONFIRMED (the absence; "by design" is the maintainer's call)
- docs/decisions.md holds three decisions (:5, :66, :92), and none is about the view class. The members are as listed:
  ExpoView subclass (MinimalWebView.kt:31, MinimalWebView.swift:4); WebView life and crash recovery
  (MinimalWebView.kt:356-404, MinimalWebView.swift:420-436); `document` registrants (MinimalWebView.kt:132-138,
  MinimalWebView.swift:109); navigation-state fields (MinimalWebView.swift:53-60); hook contexts; on iOS also the core's
  `WKNavigationDelegate` (MinimalWebView.swift:4).
- Smallest change (S): a decisions.md entry, "The view is the aggregate root", of 6-8 lines. It names those members,
  says what sits outside (Navigation, Scripts, Clients, requests/, DocumentScope, PlatformSettings, Hooks), and gives
  the reason: one owner for the WebView's lifetime.
- Breaks: nothing. It is the argument for SwiftLint's type_body_length (318 > 250) and file_length (489 > 400) on
  MinimalWebView.swift (B3-02).

```json
[
{"id":"B1-1","verdict":"CONFIRMED","evidence":"A2-features.md:17 letters are core-size classes, not plan §1 reasons; the (b)+(d) rows need absent seams (Hooks.kt:69-101, Hooks.swift:50-70); iOS PTR ~10 lines (MinimalWebView.swift:24-27,109,122-123,415) stays by consumer cost; 'Other core' (A2-features.md:40) not checkable","smallest_change":"none (keep)","size":"S","breaks":"nothing"},
{"id":"B2-05","verdict":"CONFIRMED","evidence":"uiDelegates (Hooks.swift:58), chromeClients (Hooks.kt:82), activity (Hooks.kt:72) in no doc; most platform differences ARE written (native-hooks.md:42,48-49,63-71); unwritten: Android emit/ask main-thread hop (Hooks.kt:143-146)","smallest_change":"native-hooks.md:43 names the four lists per platform; :62 adds context.activity (Android)","size":"S","breaks":"nothing"},
{"id":"B2-06","verdict":"CONFIRMED","evidence":"iOS resets on source (MinimalWebView.swift:128-129) and retry (:192-194); Android only retry (MinimalWebView.kt:233-238); CHANGELOG.md:44-45 right, props.md:18 and glossary.md:49 wrong","smallest_change":"props.md:18 and glossary.md:49: 'until the next reload() (on iOS also a source change)'","size":"S","breaks":"harness.ts:1193 check passes because reload() at :1177 already cleared the guard; rename it"},
{"id":"B2-09","verdict":"CONFIRMED","evidence":"props.md:16,67 vs decisions.md:30-31 vs Clients.kt:116-117/118-119; device notes favour 'at commit': props.md:67 chooser on 133 + MinimalWebView.kt:132 + Clients.kt:122; harness.ts:1149-1150","smallest_change":"decisions.md:30-31 says onPageStarted fires at commit (seen on 133), a never-committing load ends nothing and fires no events; delete Clients.kt:116-117; optional M: assert the <146 behaviour in checkUnlessOldWebView (harness.ts:222)","size":"S","breaks":"plan §2 Open item becomes a doc fix (maintainer confirms); settle on mrw-api36 urlTracking INFO detail"},
{"id":"B2-14","verdict":"CONFIRMED","evidence":"hook ask payload is HookEvent (types.ts:245,305) vs glossary.md:28-29 and CHANGELOG.md:11; onDownload gets Download|DownloadFailure (types.ts:188,200,345) vs glossary.md:36; not_found (protocol.ts:5) vs hook_not_handled (types.ts:260) are separate code sets, no doc says otherwise","smallest_change":"glossary.md:29 and :36 and CHANGELOG.md:11 name the two exceptions; leave error codes","size":"S","breaks":"nothing"},
{"id":"B2-17","verdict":"PLAUSIBLE","evidence":"navigation-rules.md:44-45 (Android only) vs migrating:210-211 (no platform); iOS skips .reload/.backForward (MinimalWebView+Navigation.swift:14), Android decides redirects (Clients.kt:106); WebKit's navigationType on a reload's redirect needs a device; no suite covers it","smallest_change":"migrating:210-211: '...a redirect of the source load doesn't (on Android, nor does a reload's or back/forward's redirect)'; test M: second-request-redirect route like /moved (server.js:6)","size":"S","breaks":"nothing"},
{"id":"B3-01","verdict":"CONFIRMED","evidence":"--check only in .github/workflows/test.yml:22-23, CI off (plan §0); not in development.md:3-13; no check script in package.json; both --check pass locally at HEAD","smallest_change":"add the two --check commands as one line to development.md:3-13; :26 'the --check line above fails when either is stale'","size":"S","breaks":"nothing"},
{"id":"B3-02","verdict":"CONFIRMED","evidence":"detekt 9 (exit 2), SwiftLint 5 (exit 2), ESLint 26 warnings re-run; Periphery 2 not re-run; detekt 1.23.8, SwiftLint 0.65.1, Periphery 3.8.0 all have --baseline; ESLint has --max-warnings; development.md:15","smallest_change":"write three baselines, add --baseline to development.md:19-21, lint script --max-warnings 26, reword :15","size":"S","breaks":"npm run lint fails above 26 warnings; baseline vs threshold is the D-packet decision"},
{"id":"B3-06","verdict":"CONFIRMED","evidence":"same as B2-09: decisions.md:30-31, Clients.kt:116-117 vs Clients.kt:118-119, props.md:16, harness.ts:1869 (also :922, :1149-1150, props.md:67)","smallest_change":"as B2-09","size":"S","breaks":"as B2-09"},
{"id":"B3-10","verdict":"CONFIRMED","evidence":"development.md:83 names AVDs, no creation command; local AVDs are android-37.1 google_apis_ps16k and android-36 google_apis, pixel_9_pro; :63 '<simulator udid>' only; no sample-extension compile anywhere (kotlin.yml:37 neither); :10 omits ShowsSourceTest","smallest_change":"append showsSource to :10; avdmanager lines after :86 and '16 KB pages, API 37.1' at :83; gradlew :sample-extension:compileDebugKotlin line (task name inferred, not run); iOS simulator named by the maintainer","size":"S","breaks":"nothing"},
{"id":"B4-18","verdict":"CONFIRMED","evidence":"history saved only when reload && !showsSource (MinimalWebView.kt:364-365); else loadAgain without history (:403-404, :228); docs claim always: props.md:18, glossary.md:47-48, CHANGELOG.md:45","smallest_change":"props.md:18, glossary.md:48 and CHANGELOG.md:45: 'unless the page on screen is the source or the reload was held back'","size":"S","breaks":"nothing; harness.ts:1095-1096 covers the non-source case only"},
{"id":"B5-2","verdict":"CONFIRMED","evidence":"decisions.md has 3 decisions (:5,:66,:92), none on the view class; members verified (MinimalWebView.kt:31,132-138,356-404; MinimalWebView.swift:4,53-60,109,420-436)","smallest_change":"6-8 line decisions.md entry 'The view is the aggregate root' naming members, what lives outside, and why","size":"S","breaks":"nothing; argues SwiftLint type_body_length/file_length on MinimalWebView.swift (B3-02)"}
]
```
