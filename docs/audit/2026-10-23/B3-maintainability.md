# B3 Easily maintainable (audit-2026-10-23 @ e400de9)

## (a) Summary

1. Fail, narrowly: TS behaviour changes fail a laptop test, native ones mostly don't (about 6% of native lines have one), and with CI off nothing checks the generated files or ratchets the four tools unless the maintainer remembers to.
2. The cheap fixes: a `check` script plus `pretest` (S), committed detekt/SwiftLint/Periphery baselines and `--max-warnings 0` (S), and JVM tests for `PlatformSettings` and `Downloads.fetch` after small extractions (S each). Swift settings coercion needs a simulator-SDK test binary (M).
3. Docs contradict themselves on the pre-146 commit signal (decisions.md:30-31 against props.md:16). Three user-facing rules exist only in comments. A5's survivor classes hold on 15 of the 16 I checked; 389:19 is killable, not equivalent.

## Verdict: fail (2 of the 5 tests fail, 3 pass with items; every fix is S or M)

| Test (plan section 1, row 3) | Result | Numbers (cited at HEAD) |
|---|---|---|
| A behaviour change fails a laptop test | fail for native, pass for TS | jest 199 tests; `src/bridge` gated at 80% (`stryker.config.json:7-9`); `WebView.tsx` 65.8% with 92 killable survivors. Native code with a whole-file laptop test (A5, files checked): Kotlin 82/1710 (`NavigationRules.kt`, `DocumentScope.kt`), Swift 108/1176 (`NavigationRules`, `OriginRules`, `DocumentScope`), plus `crashAllowsReload`, `showsSource` and `overrides`. Of the plan's 4 risky paths, 1 has a laptop test on one platform: crash-guard counting, Kotlin only (`CrashLoopTest.kt:8-21`) |
| Generated and mirrored things are checked, not remembered | fail | Both `--check`s exist only in `.github/workflows/test.yml:22-23`, which no longer runs, and `docs/development.md` lists neither command. The swiftc command is copied in 3 places (`development.md:11`, `ios/Tests/main.swift:3-4`, `test.yml:34`). A3 F1: 17 of 30 cross-layer values are unpinned (B5) |
| Tool baselines at zero or ratcheted | pass with items | detekt 9 and SwiftLint 5 (both exit 2), Periphery 2, ESLint 0 errors with 26 warnings (A1, unchanged). None is ratcheted: `development.md:15` calls them "reports rather than checks", so a new finding hides among the known ones. The installed detekt 1.23.8, SwiftLint 0.65.1 and Periphery 3.8.0 all take `--baseline` (checked with `--help`) |
| No stale doc claims | pass with items | 4 found: B3-06, B3-07c, and `development.md:10` and `:26` (B3-01, B3-10) |
| Decisions live in docs/decisions.md, not in comments | pass with items | 41 native comment blocks of 4 or more lines (scanned). Most describe the mechanism or repeat a doc. 3 state a rule that no doc has (B3-07), and none of them needs a decisions.md section |

## (b) Findings, ranked by impact

**B3-01. With CI off, no local command runs the CI set, and the generated files are checked only by memory.** `development.md:26` says "CI fails when either is stale", but the workflows don't run any more. The two `--check` commands (`test.yml:22-23`) are not in `development.md:3-13`, and nothing ties `npm test` to them. Measured: both checks together take 0.3 s and exit 0 today. Quality 3. Recommendation: **test**: add `"pretest": "node .github/scripts/build-page-client.mjs --check && npm run gen:platform-types -- --check"` and `"check"` (jest, lint, knip, both tsc runs, prepare, the swiftc rules) to `package.json:26-35`. Then make `development.md:11` and `:26` name `npm run check`, so the swiftc line has one copy. Stryker runs jest directly, so it doesn't run `pretest`. Size S, confidence high. What breaks: `npm test` fails while a generated file is stale, which is the point.

**B3-02. The four tools are reports, not ratchets.** Evidence: `development.md:15`, `A1-detekt.txt`, `A1-swiftlint.txt`, `A1-periphery.txt`, `A1-eslint.txt`. Quality 3. Recommendation: **simplify**:
- Fix Periphery's 2 findings (the unused `webView` in `ios/MinimalWebView+Navigation.swift:7` and `ios/MinimalWebView.swift:412`), then run it with `--strict`.
- detekt: `--create-baseline` once, then `--baseline detekt-baseline.xml`.
- SwiftLint: `--write-baseline` once, then `--baseline .swiftlint-baseline.json`.
- ESLint: `'no-void': 'off'` (all 15 uses are deliberate fire-and-forget, e.g. `src/WebView.tsx:275-278`), `--fix` for 10 more, the one at `example/harness.ts:102` by hand, then `--max-warnings 0` in `package.json:30`.

Each tool then exits 0 today and fails on any new finding, and a baseline shrinks as B4 fixes entries. Size S, confidence high. What breaks: nothing at runtime; `development.md:15-24` needs the new flags.

**B3-03. Android settings coercion has no laptop test and the most complex Kotlin code.** `PlatformSettings.kt:147-158` `coerce` has cyclomatic complexity 24. `set` (`:108-127`) and `arguments` (`:130-144`) decide which reflected method the app's value reaches. Quality 3. Today they are checked only by the `settings` suite (20 Android checks, `example/harness.ts:1299-1584`). B4 may split `coerce`, which is a refactor with no net under it today. Recommendation: **test**:
- The smallest extraction is to move `set`, `arguments`, `coerce`, `invoke` and `problem` into the existing `companion object` and make `Target` (`:32`) internal. No new lines; none of them reads instance state.
- Then a JVM test of about 40 lines: a fake settings class with an Int, a Boolean and a `String?` setter, plus a `@JvmStatic` compat-style object that takes the root first. It covers each scalar type, null for a primitive and for an object, a Boolean against a number, the `OWNED` and `_` refusals, the compat fallback order, the "no public setter takes a …" reason, and `toJson` (already internal; real org.json is on the test classpath, `android/build.gradle:25`).

Size S, confidence high. What breaks: nothing outside the file.

**B3-04. `Downloads.fetch` and its security rules are tested nowhere.** Evidence: cognitive complexity 23 (`requests/Downloads.kt:53-76`). The non-2xx failure (`:57`), the Content-Length and streamed 100 MB caps (`:59`, `:68`), the MIME fallback (`:73`) and the https-to-http redirect refusal (`:157-161`, `:168`) have no check on any layer. The device suite checks only the blob cap (`example/harness.ts:1909-1921`). Quality 3, 4. Recommendation: **test**:
- Move the `save` lambda's body into `internal fun fetchTo(client: OkHttpClient, download: DownloadInfo, file: File, max: Long = MAX_BYTES): String` (about 20 lines moved). `fetch` then drops below the threshold.
- Name the interceptor as an `internal val`.
- In a JVM test, an application interceptor that returns canned `Response`s covers status, both caps (with a small `max`) and MIME, with no server and no new dependency.
- The redirect refusal needs a fake `Interceptor.Chain` and `Call` (about 25 lines) or a TLS test server (M).

Size S (M with the redirect), confidence medium: OkHttp reaches the test classpath through `react-android`. What breaks: nothing outside the file.

**B3-05. Survivors in `WebView.tsx`: A5 holds up on 15 of 16; three groups deserve a test first.** I checked 16 survivors against the code: 42, 59:64, 212, 225, 281, 300, 315:75, 342, 389:19, 389:26, 390, 399, 424:63, 426, 437:41 and 467.
- 389:19 (`ref && …` to `ref || …`) is not equivalent. `ref={null}` is legal (`types.ts:354`, `Ref<T>` includes null), and the mutant calls `adapters.set(null, …)` on the WeakMap (`WebView.tsx:189-193`), which throws at render. So 22 survivors are equivalent and 1 is dead, not 24.
- The ones worth testing first:
  - the bridge glue (`:294-306`, 16 mutants): the origin native verified, handed to `receive`;
  - the bridge's identity in `creationKey` (`:421-428`, 11 mutants): a swapped bridge must not keep the old `allowedOrigins`. `WebView.test.tsx` never passes a `bridge`;
  - callbacks left unset (10 mutants, one test).
- The rest are cheap but lower risk: P2 and P6 to P10 (`A5-proposed-tests.txt:104-320`), with the 22 static-API mutants worth one 15-line test.
- Line 467 is dead: `requireNativeView` at `:163` throws first on other platforms.

Quality 3. Recommendation: **test**:
- Fold P1 to P10 plus a `ref={null}` render into `WebView.test.tsx`, about 240 lines on its existing mock.
- Delete `:467`.
- Add `// Stryker disable next-line BooleanLiteral` to the three `keysOf` tables (`:41-59`).
- Add `src/WebView.tsx` to `mutate` (`stryker.config.json:7`).

Size M, confidence high. What breaks: nothing. `npm run mutation` gets slower by about 10 s.

**B3-06. Two contradictory claims about the pre-146 commit signal (plan section 2, "Open").** On one side, `docs/decisions.md:30-31` and the `shortcut:` at `MinimalWebViewClients.kt:116-117` say `onPageStarted` fires at load start, so a load that never commits ends the Document spuriously. On the other, the next comment line (`:118-119`), `docs/props.md:16` ("a load that never commits fires neither event") and `example/harness.ts:1869` ("Android before 146 reports no load for it: it never commits") say Chromium calls it at commit. Quality 3. Recommendation: **document**:
- Settle it with an existing check. On `mrw-api36`, run `downloads` and read the INFO line for "the attachment load ends as cancelled" (`harness.ts:1870-1878`).
- If no load events arrive, the shortcut doesn't exist: delete `:116-117` and rewrite `decisions.md:30-31`.

Size S, confidence high that the claims conflict, medium on which is right. What breaks: docs only.

**B3-07. Three user-facing rules live only in comments.**
- (a) A download redirect from https to http is refused (`requests/Downloads.kt:157-161`, `:168`). `docs/page-requests.md:37` names only the 100 MB cap, and `docs/security.md` says nothing about it.
- (b) The Android file chooser is one at a time for the whole app; a second request gets null at once (`MinimalWebViewModule.kt:36-40`). If no result ever arrives, every chooser stays cancelled until relaunch (`:61`). `page-requests.md:9` says neither.
- (c) Only `reload()` resets Android's crash-guard count (`MinimalWebView.kt:232-238`; `crashTimes` is cleared nowhere else). iOS also resets it on a source change (`ios/MinimalWebView.swift:128-129`). `props.md:18` and `glossary.md:49` say "until the next `source` change or `reload()`" for both; only `decisions.md:63-64` has the split.

None of these is a choice with rejected alternatives, so they belong in the user docs, not in decisions.md. Quality 3. Recommendation: **document** (one clause each in `page-requests.md`, `security.md` and `props.md:18`). Size S, confidence high. What breaks: nothing.

**B3-08. Cross-platform twins where only the Kotlin half is tested, and they already differ.**
- Crash guard: Kotlin `crashAllowsReload` (`MinimalWebView.kt:497-501`, 7 cases) against Swift's inline version (`ios/MinimalWebView.swift:424-426`, none). At exactly 60 s Kotlin still counts a crash (`<=`) and Swift doesn't (`<`); the 100 ms same-death merge is Android-only by design.
- "Is the page on screen the source": `showsSource` (`MinimalWebView.kt:485-490`, 10 cases) against `onSource` and `sameURL` (`ios/MinimalWebView.swift:164-169`, `+Navigation.swift:114-121`, none). Kotlin treats `/pay/` and `/pay` as the same page; Swift equates only an empty path with `/`. That decides whether a POST source is sent again after a crash.

Quality 3, 5. Recommendation: **test**:
- Move the Swift guard into a free function and `sameURL` into a Foundation-only `ios/Recovery.swift` (about 15 lines moved), and add it to the swiftc build.
- Add `src/__tests__/vectors/recovery.json` (crash times with a per-platform merge flag; URL pairs) for `CrashLoopTest`, `ShowsSourceTest` and `main.swift` to read. Both test trees already reach the vectors through symlinks.
- The trailing-slash rule is the maintainer's pick.

`enables` (`Hooks.kt:66`, `Hooks.swift:43-47`) agrees today, and 3 assert lines in `HooksTest` are enough for it. Size S, confidence high. What breaks: the two JVM tests read JSON; the swiftc command gains a file.

**B3-09. Swift settings coercion, the guard that keeps KVC from crashing the app, has no laptop test.** `ios/PlatformSettings.swift:143-183` has complexity 24, and its own doc comment says a wrong value "can take the process down" (`:13-15`). It imports UIKit and MinimalWebView's Objective-C helpers, so it can't join the macOS swiftc build. I checked one route: a copy of `coerce` and `color` compiles with `xcrun --sdk iphonesimulator swiftc -target arm64-apple-ios16.4-simulator` in 1.2 s. Running it needs `xcrun simctl spawn <booted udid>`, which I didn't run (no devices in Phase B). Quality 3. Recommendation: **test**: move `coerce` and `color` (`:142-192`) into `ios/SettingValues.swift`, make them internal, and add a second, simulator-run test binary. The scalar cases can share a `setting-values.json` vector with B3-03. Size M, confidence medium. What breaks: a booted simulator becomes part of the Swift unit loop (maintainer question 2).

**B3-10. `development.md` has gaps for a maintainer working only on a laptop.**
- `:10` leaves out `ShowsSourceTest`.
- `:83-86` names `mrw-api37` and `mrw-api36` but not the `sdkmanager` and `avdmanager create avd` lines that rebuild them.
- No reference iOS simulator is named (plan section 8 says iOS 18+).
- The sample extension, the yardstick for the hooks API, is compiled only by a device build. `./gradlew :sample-extension:compileDebugKotlin` would catch a hooks change in seconds (project name from `example/modules/sample-extension/package.json`; confirm with `./gradlew projects`).

Quality 3. Recommendation: **document**. Size S, confidence medium-high. What breaks: nothing.

**B3-11. Device-only paths to keep there.** These stay on device: the navigation policy around the shared matcher (ask timeout, late answer, cache population, reissue, subframe ask to block: `MinimalWebViewNavigation.kt:37-84`, `+Navigation.swift:57-111`), recovery's WebView lifecycle (`MinimalWebView.kt:356-407`), the script transport, pull-to-refresh and fullscreen. Each depends on Chromium's or WebKit's callback order, which a fake would only restate. The policy-module extraction was rejected (plan section 2). The device checks are reissue 11, navigation 19, crash 19, bridge 23, ptr 7 and fullscreen 6 (`A5-suite-map.tsv`). The match decisions themselves are already in the vectors (5 `asked` and 3 `canAsk` cases). Quality 3. Recommendation: **keep**. Size S, confidence medium. What breaks: nothing.

**B3-12. The device loop costs more than it needs to.** `example/harness.ts` is 2505 lines with 62 literal `await sleep(` calls, 34.8 s per run (measured), against about 3 min a platform. `test-strategy.md` findings 7 and 8 (a settle barrier, one file per suite) are still open. Quality 3. Recommendation: **simplify**: a `settle()` that polls `ref.get` after `setProps`, in place of the post-prop sleeps. Size M, confidence medium. What breaks: harness only.

**B3-13. `build-page-client.mjs` is the one untyped script.** The maintainer's agent guard blocks edits to `.mjs` files, and the plan's rule is `.mts`. It also carries 6 of the 26 ESLint warnings (A1-08). Quality 3. Recommendation: **simplify**: rename it to `.mts` and update `package.json:33` and the new `pretest`. Size S, confidence high. What breaks: `test.yml:22` names the file (the workflows are off; leave them alone per plan section 0).

## (c) Out of slice

- Mirrored values that no test pins (A3 F1, 17 of 30): B5.
- `.swiftlint.yml:5` `ignores_case_statements` hides Swift `coerce`; whether to fix or accept each of the 14 complexity findings: B4.
- `PlatformSettings.kt:151` truncates 1.5 to 1 for an Int setter without a warning; Swift likely does the same through KVC (inferred, not run).
- `Permissions.originOf` (`requests/Permissions.kt:57-62`) is a second origin serializer with no shared case against `OriginRules.origin`: B5.
- On iOS, `answer` is inlined in `MinimalWebViewModule.swift:55`, where Kotlin calls `view.answer`: B4/B5.

## (d) Questions only the maintainer can answer

1. Commit tool baselines now (B3-02), or fix each tool to zero first?
2. Is a booted simulator acceptable in the Swift unit loop (`simctl spawn`, B3-09), or do Swift tests stay macOS-only, leaving `coerce` on device?
3. 1.5 for an integer setting: truncate silently (today) or reject with a warning? The B3-03 and B3-09 vectors would pin the answer.
4. Trailing slash in "the source is on screen": does `/pay/` match `/pay` (Kotlin) or not (Swift)? (B3-08)
5. Should `WebView.tsx` join the 80% gate once the tests land (A5 question 1)?

```json
[
{"id":"B3-01","file":"docs/development.md","line":26,"quality":3,"claim":"CI is off, so the generated-file --check commands run nowhere and appear in no local command; development.md still says CI fails on a stale file; no single local check entrypoint","recommendation":"test","size":"S","confidence":"high"},
{"id":"B3-02","file":"docs/development.md","line":15,"quality":3,"claim":"detekt 9, SwiftLint 5, Periphery 2, ESLint 26 warnings are reports, not ratchets; all three native tools support baselines, so new findings could fail today","recommendation":"simplify","size":"S","confidence":"high"},
{"id":"B3-03","file":"android/src/main/java/expo/modules/minimalwebview/PlatformSettings.kt","line":147,"quality":3,"claim":"coerce/set/arguments (cyclomatic 24) have no laptop test; moving them to the companion makes them JVM-testable with a fake class, no new lines","recommendation":"test","size":"S","confidence":"high"},
{"id":"B3-04","file":"android/src/main/java/expo/modules/minimalwebview/requests/Downloads.kt","line":53,"quality":3,"claim":"fetch (cognitive 23): non-2xx, both 100 MB caps, MIME fallback and the https-to-http redirect refusal are tested on no layer; a fetchTo extraction makes them JVM-testable","recommendation":"test","size":"S","confidence":"medium"},
{"id":"B3-05","file":"src/WebView.tsx","line":389,"quality":3,"claim":"A5 survivor classes hold on 15 of 16 checked; 389:19 is killable via ref={null} (WeakMap throws); bridge glue and creationKey bridge identity deserve tests first; line 467 is dead","recommendation":"test","size":"M","confidence":"high"},
{"id":"B3-06","file":"docs/decisions.md","line":30,"quality":3,"claim":"decisions.md:30-31 and MinimalWebViewClients.kt:116-117 say pre-146 onPageStarted is at load start; Clients.kt:118-119, props.md:16 and harness.ts:1869 say at commit","recommendation":"document","size":"S","confidence":"medium"},
{"id":"B3-07","file":"android/src/main/java/expo/modules/minimalwebview/requests/Downloads.kt","line":157,"quality":3,"claim":"rules only in comments: download https-to-http refusal, app-wide single file chooser stuck until relaunch, Android crash-guard reset only by reload() while props.md:18 and glossary.md:49 say source change too","recommendation":"document","size":"S","confidence":"high"},
{"id":"B3-08","file":"ios/MinimalWebView.swift","line":424,"quality":3,"claim":"iOS crash guard and sameURL/onSource are untested twins of tested Kotlin code and already differ (60 s boundary, trailing slash); a recovery.json vector pins both","recommendation":"test","size":"S","confidence":"high"},
{"id":"B3-09","file":"ios/PlatformSettings.swift","line":143,"quality":3,"claim":"Swift coerce (CCN 24, the KVC crash guard) cannot join the macOS swiftc build; it compiles with the iOS simulator SDK, run via simctl spawn","recommendation":"test","size":"M","confidence":"medium"},
{"id":"B3-10","file":"docs/development.md","line":83,"quality":3,"claim":"development.md lacks AVD creation commands, a reference iOS simulator, the sample extension compile, and ShowsSourceTest in the JVM line","recommendation":"document","size":"S","confidence":"medium"},
{"id":"B3-11","file":"android/src/main/java/expo/modules/minimalwebview/MinimalWebViewNavigation.kt","line":37,"quality":3,"claim":"navigation policy, recovery lifecycle, script transport, pull-to-refresh and fullscreen depend on engine callback order and stay device-only","recommendation":"keep","size":"S","confidence":"medium"},
{"id":"B3-12","file":"example/harness.ts","line":2484,"quality":3,"claim":"harness is 2505 lines with 62 literal sleeps (34.8 s per run); a settle() barrier after setProps removes most","recommendation":"simplify","size":"M","confidence":"medium"},
{"id":"B3-13","file":".github/scripts/build-page-client.mjs","line":1,"quality":3,"claim":"the one .mjs script, against the .mts rule; carries 6 of the 26 ESLint warnings","recommendation":"simplify","size":"S","confidence":"high"}
]
```
