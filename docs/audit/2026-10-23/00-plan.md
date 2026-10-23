# Quality review plan: minimal-rn-webview @ b453623 (2026-10-23)

Purpose: decide, with evidence, whether the package (1) has a properly minimal core, (2) has good interfaces, (3) is
easily maintainable, (4) has code that is easy to reason about, (5) is decoupled; then fix what the maintainer picks.
Written for an agent orchestrator: an agent gets this file and the paths it names, nothing else from the sessions
that produced it. Sections 2 and 3 carry the decisions and numbers those sessions established.

## 0. Read first, and the rules for every agent

- Read `docs/glossary.md`, `docs/decisions.md`, `CLAUDE.md` and `docs/development.md` before anything
  else. Use the glossary's words: **Core**, **Native hook**, **Ask**, **Page request**, **Document**.
- Branch: create `audit-2026-10-23` from `main` once PR #41 (`tooling-and-docs-cleanup`, 7eed9b7: the tool configs,
  `docs/decisions.md`, `docs/glossary.md`) is merged, otherwise from that branch. First commit: this file. Reports go in
  `docs/audit/2026-10-23/` on this branch, as `docs/audit/2026-10-21/` does on branch `audit-2026-10-21`.
- Phases A to C are read-only for `src/`, `ios/`, `android/`, `example/` and `docs/` outside this directory. Phase D
  edits code, and only after the maintainer's picks (section 7).
- No CI work: the GitHub Actions credits are exhausted. Every check runs locally (section 8). Don't touch
  `.github/workflows/`.
- Cite `path:line` at the branch head for every claim. A finding without a citation is dropped in Phase C.
- Don't re-litigate section 2's decided items. The deferred items are reopened only inside B1's decision packet,
  because their stated condition ("once the seams land") is now met; nobody implements them without the maintainer.
- Consumer cost rule (the maintainer's, learned when `get`/`call` were cut and restored on 2026-10-15): a cut that
  pushes work into consumers' native code is costed by what each consumer would then write. An Expo module means a
  module config, podspec, gradle file, Swift, Kotlin, a JS wrapper and a native rebuild. "Few consumers use it" means
  nothing for a package with no consumers; its purpose (less consumer boilerplate) is what counts.
- Breaking changes are free (no releases, no users). Say what breaks.
- Commits: subject line only, a body only for something significant, no attribution lines. Push to branches freely.
  **Never open a PR without asking the maintainer.**
- A script added under `.github/scripts/` is typed `.mts`, never `.mjs`.
- Report format, every agent: (a) a 3-line summary; (b) findings ranked by impact, each with the claim, evidence
  `path:line`, the quality 1 to 5 it bears on, a recommendation from {keep, simplify, split, move-to-extension (with
  the consumer cost written out), delete, add-seam, document, test}, size S/M/L, confidence, and what breaks;
  (c) out of slice, one line each; (d) questions only the maintainer can answer. End with a fenced JSON block, one
  object per finding: `{id, file, line, quality, claim, recommendation, size, confidence}`. At most 200 lines.

## 1. The five questions, made measurable

| # | Quality | Operational test | Evidence |
|---|---|---|---|
| 1 | Minimal core | Every feature in Core is there for one of three reasons: (a) the platform default is wrong or unsafe without it, (b) it is the seam itself, (c) rebuilding it would cost each consumer more than it costs the library. Anything else is a candidate to move or delete. | A2 feature table, A1 sizes, section 2's seams, `docs/audit/2026-10-21/core-size.md` |
| 2 | Good interfaces | One way to do each thing. Names follow the documented conventions (`…Request` for asks, `…Event` for notifications, lowercase error codes). Platform-symmetric except the documented platform-only items. Discriminated unions where states differ (`outcome`, `kind`, `ok`). Docs equal code. The hooks API reads the same in Swift and Kotlin. | A4 inventory and drift list, `api-surface.md`, `hooks-mechanism.md`, `extension-gaps.md` |
| 3 | Easily maintainable | A behaviour change fails a test that runs on a laptop. Generated and mirrored things are checked, not remembered. Tool baselines are at zero or ratcheted. No stale doc claims. Decisions live in `docs/decisions.md`, not in comments. | A5 test map, A1 baselines, Stryker survivors, `test-strategy.md`, `platform-parity-drift.md` |
| 4 | Easy to reason about | A newcomer follows the four walkthroughs in B4 with at most one jump per step and no invariant that is relied on but not written where it is relied on. Functions are under the complexity thresholds, or the threshold is argued and raised. | A1 complexity findings, the walkthroughs |
| 5 | Decoupled | Each file depends on the narrowest thing that serves it. The view class is an aggregate root by design, not by accretion. Cross-platform logic has shared vectors or a stated reason not to. Cross-layer names and keys are pinned by a test. | A3 coupling map, `nativeContract.test.ts`, `src/__tests__/vectors/` |

## 2. What is already decided (don't redo it)

Prior work: the deep audit of 2026-10-21 (22 read-only slices, `docs/audit/2026-10-21/` on branch `audit-2026-10-21`;
`01-synthesis.md` is its ranked backlog, `00-plan.md` its slice list). Its Tier 1 (PR #35), Tiers 2 and 3 (PR #36) and
the WebView 133 fixes (PR #40) are merged: 59 commits between 806d16f and b453623. The architecture review's
candidate 1 (DocumentScope) shipped earlier in PR #34. The two new dimensions here are 4 and 5; 1 to 3 are
re-measured after those 59 commits, not re-derived.

**Done** (from the synthesis; verify only if a finding depends on it): Android recovery and state fixes; iOS hook
ordering, weak contexts, hooks' scripts kept, settings before attach, observation fan-out; `creationKey` remounts the
whole instance; sharedCookies deletion sync; downloads on one IO thread with a 100 MB cap; `get`/`call` guards;
new-window scheme blocks; bridge origin argument; `onLoad` gone and `onLoadEnd`'s `state.outcome` from native;
`onError` union; lowercase error codes; `…Request`/`…Event` names; `WebViewProps` with `ref`; `onDownload.ok`; a dead
handle rejects `unavailable`; no restated TS defaults; typed `createBridge<Methods, Events>`; live `hookOptions`;
`ref.hook` ↔ `context.handle`; `context.url` and `onDocumentEnd`; ask cancellation with `AbortSignal`; Android
per-process crash guard, `saveState` history, deferred recovery; iOS `@objc invalidate()` teardown; the decisions that new
windows load in place and that universal links stay in place (`docs/decisions.md`); payload-key contract test; migration page; CHANGELOG; exports map.

**Keep**, decided by the maintainer (don't propose otherwise): the `userAgent` prop; `get`/`call` and MRWInvoke;
`warmUp`/`preconnect`; downloads in the package; the permissions JS path (the origin check is security code); the
bridge; `onLoadStart`/`onLoadEnd`; `userInitiated` in the rule DSL.

**Rejected**: a navigation policy module (review candidate 2) as written, the ask gate moved into the shared matcher
instead; codegen for the wire contract (a payload-key test instead, done); deleting `onLoadStart`/`onLoadEnd`.

**Deferred** by the maintainer on 2026-10-22, condition "revisit once the seams land" (live hook options and JS→hook
calls landed in PR #36; S2 to S6 below have not): `context.holdLoads()`, a before-load gate (S5); decision hooks
falling back to the core (`context.core`); moving sharedCookies, pull-to-refresh and download saving out of Core; a
gesture-gated default `external` and refusing the app's own scheme. B1 re-costs the three moves and S2 to S6 as a
decision packet.

**Seams** named by `core-size.md` (S1, live hook options, is done): S2 an Android content wrapper a hook can own
(~10 lines); S3 Android download listeners on `WebViewContext` (~8); S4 an iOS response-policy split so a hook sees
downloads without taking `decidePolicyForNavigationResponse` (~10); S5 an iOS before-load gate (~12);
S6 `context.reload()` (~4).

**Open**: the Document scope decision (`docs/decisions.md`) says a load that never commits ends the Document spuriously before WebView 146; the comment at
`MinimalWebViewClients.kt:115-118` says Chromium calls `onPageStarted` at commit. Unresolved, not claimed in user
docs. Dependabot PRs #37 to #39 are out of scope.

## 3. Baseline measured on 2026-10-23 (main @ b453623; PR #41 changes only configs, docs and comments)

Sizes (cloc, tests and generated files excluded): Kotlin 1710, Swift 1176, TypeScript 920 code lines; 76% native.
The hand-written TS is 7 files with an acyclic import graph: `WebView.tsx` → `bridge/createBridge`,
`bridge/endpoint`, `types`; `types` → `bridge/protocol` and `platform.generated` (type-only).

| Tool | Scope | Today | Findings |
|---|---|---|---|
| detekt (`detekt.yml`) | Kotlin complexity, unused private code | 9 | `PlatformSettings.coerce` cyclomatic 24; `PlatformSettings.apply` cyclomatic 16, cognitive 15; `Downloads.fetch` cognitive 23; `MinimalWebViewModule.definition` 77 lines, cyclomatic 15, cognitive 19; `MinimalWebView` 20 functions (threshold 11); `NavigationRules.matches` 6 parameters |
| SwiftLint (`.swiftlint.yml`) | Swift complexity | 5 | `MinimalWebView.swift` 489 lines, class body 318; the module `definition` 62 lines; `OriginRules.swift:27` a 3-tuple; `NavigationRules.swift:78` 6 parameters |
| Periphery (`.periphery.yml`) | unused Swift | 2 | unused `webView` parameter in `decideNavigation` (`MinimalWebView+Navigation.swift:7`) and `loadEnded` (`MinimalWebView.swift:412`) |
| Stryker | `src/WebView.tsx` alone | 65.8% | 221 killed, 115 survived, 10 s. The 80% gate covers `src/bridge` only |
| knip; ESLint with sonarjs cognitive 15, nesting 3, identical functions | TS | 0 | both green |
| jscpd, 50 tokens | all three languages | 0 clones | cross-language duplication is invisible to it |
| Fan-in | native | — | `MinimalWebView` is referenced by 12 of 14 Kotlin files and 8 of 13 Swift files; every other type by 2 to 5 |

Existing checks (commands in section 8): jest, 7 suites, including `nativeContract.test.ts` (prop, event and function
names across Swift, Kotlin and the JSX; page-request routes; payload keys) and type tests; the TS origin matcher, the
Swift origin and navigation matchers and the Kotlin navigation matcher on the shared vectors in
`src/__tests__/vectors/`; 6 Kotlin JVM tests; `ios/Tests/main.swift`; two generated files with `--check`; Stryker at
80% on `src/bridge`; the on-device suites (Maestro, `SUITES` in `example/harness.ts`, about 3 min per platform).

## 4. Phase A: measure (five agents in parallel, read-only; a cheaper model is fine)

Each writes `docs/audit/2026-10-23/A<n>-<slug>.md` and any data file it names.

- **A1 baseline.** Re-run every tool in section 3 on the branch head and record the exact output. Also
  `uvx lizard -l swift -l kotlin -l typescript -C 15 -L 60 -w src ios android/src/main` and the jscpd line from
  section 8. Any number that differs from section 3 is reported first: it means the tree moved.
- **A2 feature table.** Lines and cognitive complexity per feature per platform: the update of `core-size.md`'s
  table, with classes (a)/(b)/(c)/(d) and the seam each (d) needs. Preferred route: repair `feature-tree/run.sh`
  (local and gitignored; it still runs `eslint.ci.config.mjs`, deleted since, so point it at `eslint.config.cjs`; it
  needs `brew install fummicc1/tap/swift-complexity`; `verify.py` lists the `map/*.txt` line numbers that drifted over
  59 commits) and regenerate `feature-tree/FEATURE_TREE.md`. Cap it at 45 minutes; the fallback is `core-size.md`'s
  method, line ranges per feature by hand, physical lines. Output `A2-features.md`: the table with deltas against
  2026-10-21, and the features whose class changed because live hook options and `ref.hook` exist now.
- **A3 coupling map.** For each Kotlin and Swift file: the types it references, and for every reference to the view
  class the exact members used (`grep -o 'view\.\w\+'`, `owner\.\w\+`, then read), grouped as: needs the whole view /
  needs a `WebViewContext`-shaped subset / needs one callback. TS: the 7-file import graph and what each function in
  `WebView.tsx` touches (`WebViewInstance`, `useAttach`, `useRequestHandlers`, `useLoadEvents`, `platformSettings`,
  `creationKey`, the ref adapters). Cross-layer: every name or key mirrored by hand between TS, Kotlin and Swift, and
  whether a test pins it (`nativeContract.test.ts` pins names, routes and payload keys; check error codes,
  `DocumentScope.End` reasons, the hook event name format, settings root names). Output `A3-coupling.md`.
- **A4 interface inventory and drift.** The four surfaces side by side: TS (`src/index.ts`, the 31 exports of
  `types.ts`, props, ref methods, error codes); the bridge (`createBridge`, the page client, `BridgeErrorCode`); the
  hooks API (Swift `MinimalWebViewHooks` and `WebViewContext` in `ios/Hooks.swift` against Kotlin's in
  `android/.../Hooks.kt`: today Swift has `navigationDelegates`, `uiDelegates`, `webViewClass`, Kotlin has `clients`,
  `chromeClients`, `activity`, `webViewFactory`, the rest matches); page requests (the `core.*` routes); settings
  roots. Then docs against code: every prop, method and type named in `docs/props.md`, `bridge.md`,
  `native-hooks.md`, `page-requests.md`, `platform-settings.md`, `navigation-rules.md`, `navigation-state.md`,
  `README.md` and `docs/glossary.md` against `types.ts`, `WebView.tsx` and both native modules; list each mismatch with
  both locations. Output `A4-interfaces.md`; a docs↔code drift test that fits in 40 lines is proposed in the report,
  not committed.
- **A5 test map.** Every source file → the tests that exercise it (jest file, vector set, JVM test, Swift test, the
  on-device suite ids from `SUITES`), or "only on device", or "nothing". Run
  `npx stryker run --mutate src/WebView.tsx --reporters clear-text,html`, group the survivors by function and classify
  each: untested branch, dead code, or equivalent mutant. Output `A5-tests.md`.

## 5. Phase B: judge (five agents in parallel, read-only, the most capable model; one per quality)

Each gets its row of section 1, the A reports named, the prior reports named, and section 2. Each delivers a verdict
(pass / pass with items / fail) with the numbers behind it, then the ranked list in the section 0 format.

- **B1 Minimal core.** Inputs: A2, A3, `core-size.md`. (i) Per feature, which of (a)/(b)/(c) holds today, with the
  consumer-cost line written out; the yardstick is `example/modules/sample-extension`: 86 lines of Kotlin, 103 of
  Swift, 17 of TS and about 45 of config for three hooks. (ii) The three deferred moves, sharedCookies (82 lines),
  pull-to-refresh (131) and download saving (about 240), each with the seams it needs from S2 to S6: lines leaving
  Core, seam lines added, what a consumer who wants the feature then does (an in-package extension under a
  `hookOptions` key?), what breaks. (iii) Anything in Core that stopped earning its place after PR #36. (iv) The
  direct `com.facebook.react:react-android` dependency in `android/build.gradle:22` exists for
  `ForwardingCookieHandler` and OkHttp in `requests/Downloads.kt:7-12`: whether `CookieManager` plus
  `HttpURLConnection` can drop both (core-size question 5), and what it costs. Deliverable: a decision packet
  (options, library lines, consumer cost, what breaks, a recommendation), not a verdict that pre-empts the maintainer.
- **B2 Good interfaces.** Inputs: A4, `api-surface.md` (F1 to F15, most done), `hooks-mechanism.md`,
  `extension-gaps.md` (nine missing seams: which still exist), `rnw-feature-matrix.md`. The convention check over all
  four surfaces; the hooks API asymmetry (is `activity` Android-only by necessity, and should the delegate-list vs
  client-list difference be documented as the one intentional one?); every `Any?` / `Map<String, Any?>` /
  `[String: Any]` boundary and whether a typed alternative is cheaper than it looks; the ten extension sketches
  re-scored against today's seams; A4's drift list as findings.
- **B3 Easily maintainable.** Inputs: A1, A5, `test-strategy.md`, `platform-parity-drift.md`,
  `tooling-ci-release.md`. The risky paths tested only on device (the crash guard policy, `PlatformSettings.coerce`,
  `Downloads.fetch`, recovery) and which could become a JVM or Swift unit test or a shared vector set like the
  matchers'; the 115 survivors: which deserve a test, which expose dead code; cross-platform parallel logic without
  vectors (start from the parity report's table); decisions living in comments (native comment blocks over three
  lines that state a rule) that belong in `docs/decisions.md` or the glossary; the baseline findings as debt, fix or ratchet;
  whether `docs/development.md` is complete for a laptop-only maintainer.
- **B4 Easy to reason about.** Inputs: A1, `docs/glossary.md`, `docs/decisions.md`. Four newcomer walkthroughs, each written down as the
  sequence of files and functions visited, with every jump and every invariant relied on but not written where it is
  relied on: (1) a main-frame navigation with an `ask` rule on both platforms, from `shouldOverrideUrlLoading` /
  `decidePolicyFor` to the JS handler and back, including the 1 s block and the ask cache; (2) a renderer crash with
  recovery on Android (new WebView, `saveState`, deferred while detached, hooks re-attached) and on iOS; (3) a hook's
  `attach` and detach across a crash, and a `ref.hook` call; (4) a bridge call from the page with the origin check,
  with the Document ending mid-call. Then each of the 14 detekt and SwiftLint findings in section 3: fix (how, smallest) or
  accept (the honest threshold and why). For the two view classes of about 500 lines and the two module
  `definition`s: whether grouping by feature (Swift `+Feature.swift` extensions, Kotlin files per feature as
  `requests/` already does) removes jumps or only moves lines.
- **B5 Decoupled.** Inputs: A3, A4, `hooks-mechanism.md`. Is the view class (36 functions in Kotlin, 30 in Swift, the
  fan-in above) an aggregate root by design (then `docs/decisions.md` should say so and name what belongs to it) or by accretion
  (then which collaborators could take a `WebViewContext`-shaped interface instead, that is, could Core's own
  features be written against the seam hooks use; cost per feature; what breaks). `WebView.tsx` at 533 lines: which
  functions are the component, the ref adapter, the settings mapper and the load-event machine, and whether separate
  files help a reader or only knip. Cross-platform: the logic that exists twice without shared vectors, as
  candidates for `src/__tests__/vectors/`. Cross-layer: what A3 found mirrored and unpinned, and the cheapest pin.

## 6. Phase C: verify, then synthesize

- **C1 adversarial verification.** Fresh agents, one per file group, in parallel. Each gets the finding's JSON object
  and the code, never the B report's reasoning. For each finding: read the cited lines and their callers at the
  branch head; answer CONFIRMED, REFUTED or PLAUSIBLE with evidence; check the recommendation is the smallest change
  and list what it breaks (callers, tests, vectors, docs, suites). A refuted finding leaves the synthesis with one
  line saying why.
- **C2 synthesis**, one agent, into `01-synthesis.md`: for each of the five qualities, a one-paragraph verdict with
  the numbers behind it; cross-confirmed items, naming the B reports that reached them independently; disagreements
  between B agents with a resolution or "maintainer decides"; then the backlog in three tiers. **S**: do now
  (S-size, confirmed, no decision needed). **D**: the decision packet for the maintainer, each item with options,
  library lines, consumer cost, what breaks and the recommendation: B1's three moves and S2 to S6, the Document scope open
  question, the aggregate-root decision, and the detekt and SwiftLint thresholds to adopt. **X**: not doing, one line
  each (re-affirmed keeps, refuted, too costly). Append the consolidated questions only the maintainer can answer.

Stop here and hand `01-synthesis.md` to the maintainer. Nothing in Phase D starts before their picks.

## 7. Phase D: act (gated on the maintainer's picks)

- One branch `quality-2026-10-23` from `audit-2026-10-23`. Waves of two or three independent items; an agent per item
  in its own worktree, reset to the branch head first (worktrees are created from `main`:
  `git reset --hard quality-2026-10-23`), then `npm ci` in the root and in `example/`. Native items in one wave must
  not touch the same files.
- Per item: the smallest diff that fully does it, including callers, tests, vectors, fixtures and docs (`docs/*.md`,
  `docs/glossary.md`, a `docs/decisions.md` section when a decision changes, `CHANGELOG.md` under Unreleased when the API changes), and the
  generated files (`npm run build:page-client`, `npm run gen:platform-types`) when their sources change.
- In the worktree: `npm test`, `npm run lint`, `npx knip`, both `tsc --noEmit`, `npm run prepare`. From the main
  checkout after the wave is merged into the branch (it has `example/ios/Pods`, `example/android` and the devices):
  the Kotlin JVM tests, the `swiftc` rule tests, `npm run mutation` when `src/bridge` changed, detekt, SwiftLint,
  Periphery, Stryker on `WebView.tsx`, and for any native or `WebView.tsx` change the on-device suites on both
  platforms (section 8). One device per platform; start the second platform about 10 s after the first. A first run
  after an emulator boot may fail `urlTracking` or `upload` once: rerun before investigating. Compare with `main`
  before blaming a change.
- Ratchet: when a wave makes detekt or SwiftLint pass at a lower threshold, lower it in `detekt.yml` /
  `.swiftlint.yml` in the same wave. Never raise a threshold without a line in `01-synthesis.md`.
- Commits: subject only; one item per commit; say what breaks. Push the branch. **Ask before opening a PR.**
- Done: `03-result.md` restates the five verdicts with the post-change numbers, lists every S item as merged or with
  why not, and `docs/development.md` is still true.

## 8. Commands (repo root; everything local)

```sh
npm install && (cd example && npm install)
npm test -- --watchAll=false                       # jest, 7 suites
npm run lint && npx knip && npm run prepare
npx tsc --noEmit -p src/__tests__/tsconfig.json && (cd example && npx tsc --noEmit)
(cd example/android && ./gradlew :minimal-rn-webview:testDebugUnitTest)   # Kotlin JVM tests; example/android must exist
xcrun swiftc ios/NavigationRules.swift ios/OriginRules.swift ios/DocumentScope.swift ios/Tests/main.swift -o /tmp/rules && /tmp/rules
npm run mutation                                   # Stryker on src/bridge, fails below 80%
npx stryker run --mutate src/WebView.tsx           # a report: 65.8% today, so it exits 1
detekt --input android/src/main --config detekt.yml
swiftlint lint
periphery scan                                     # builds the example app itself, about 40 s; needs example/ios with Pods installed
cloc --quiet --exclude-dir=__tests__,Tests,test --not-match-f='\.generated\.' src ios android/src/main
uvx lizard -l swift -l kotlin -l typescript -C 15 -L 60 -w src ios android/src/main
npx -y jscpd src ios android/src/main --ignore '**/__tests__/**,**/Tests/**,**/test/**,**/*.generated.ts' --min-tokens 50 --reporters console
# On-device, see docs/development.md "On-device suites": in example/, `npm run test-pages` and `npx expo start --clear`,
# install the app, then:
example/maestro/run.sh android <emulator serial>   # mrw-api37 is the reference (WebView 149); mrw-api36 (WebView 133) reports known limits as INFO
example/maestro/run.sh ios <simulator udid>        # an iOS 18+ simulator
```

Fan-in per declared type (Kotlin; for Swift use `ios/*.swift` and `class|struct|enum|protocol`):

```sh
cd android/src/main/java/expo/modules/minimalwebview && for t in $(grep -rhoE '^(internal |private |open |abstract |data |sealed |enum |fun )*(class|object|interface) \w+' --include='*.kt' . | awk '{print $NF}' | sort -u); do printf '%3d %s\n' "$(grep -rlw "$t" --include='*.kt' . | wc -l)" "$t"; done | sort -rn
```

## 9. Orchestration notes

- Agents: A1 to A5 in parallel (5); B1 to B5 in parallel after A (5); C1 one verifier per file group (6 to 8); C2 one.
  About 20 agents before Phase D. Phase D: two or three per wave, waves in sequence.
- Every agent runs in the background and its report is the only output that counts; keep tool output out of the
  orchestrator's context.
- Time: A about 1 h wall (A2 is the long pole, capped), B about 1 h, C about 45 min.
- Devices only in Phase D, never two runs on one platform at once. Emulators are Google APIs images started with
  `-gpu host` (`mrw-api37`, `mrw-api36`). Don't pipe Metro to `head`. Don't edit JS while a suite runs: Fast Refresh
  pushes it into the running app mid-suite.
- On `audit-2026-10-23` only this directory changes.

## 10. File map

- TS, `src/`: `index.ts` (exports); `types.ts` (public types, 407 lines); `WebView.tsx` (component, ref adapters,
  settings mapper, load events, `useWebViewState`; 533); `bridge/protocol.ts` (wire types), `bridge/endpoint.ts`
  (shared endpoint, origin parsing), `bridge/createBridge.ts` (RN side), `bridge/pageClient.ts` (page side, built into
  `pageClient.generated.ts`); `platform.generated.ts` (settings keys and constants, generated).
- Android, `android/src/main/java/expo/modules/minimalwebview/`: `MinimalWebView.kt` (view, 507),
  `MinimalWebViewModule.kt` (Expo module, 216), `MinimalWebViewClients.kt` (WebViewClient and WebChromeClient routing
  to core and hooks, 354), `MinimalWebViewNavigation.kt` (rules and ask, 176), `MinimalWebViewScripts.kt` (bridge,
  evaluate, injected scripts, 160), `Hooks.kt` (registry and `WebViewContext`, 181), `PlatformSettings.kt` (204),
  `NavigationRules.kt` (matcher, 103), `PullToRefresh.kt` (76), `DocumentScope.kt` (18), `requests/Downloads.kt`
  (174), `requests/FullscreenVideo.kt` (92), `requests/Permissions.kt` (71), `requests/FileUpload.kt` (27). Tests:
  `android/src/test/java/expo/modules/minimalwebview/` (6 files).
- iOS, `ios/`: `MinimalWebView.swift` (view, 489) with `MinimalWebView+Navigation.swift` (128),
  `+Dialogs.swift` (92), `+Scripts.swift` (96); `MinimalWebViewModule.swift` (110); `Hooks.swift` (registry and
  `WebViewContext`, 131); `DelegateProxy.swift` (decision and observation routing, 53); `PlatformSettings.swift` (199);
  `NavigationRules.swift` (104); `OriginRules.swift` (31); `DocumentScope.swift` (16); `Downloads.swift` (75);
  `SharedCookies.swift` (64); `MRWInvoke.h/.m` and `MRWExceptions.h/.m` (Objective-C behind `get`/`call`).
  Tests: `ios/Tests/main.swift`.
- Example, `example/`: `harness.ts` (the suites), `maestro/` (the flows and `run.sh`), the test pages server,
  `modules/sample-extension` (the hooks yardstick).
- Docs: `README.md`, `ROADMAP.md`, `CHANGELOG.md`, `docs/*.md` (props, bridge, native-hooks,
  page-requests, platform-settings, navigation-rules, navigation-state, security, migrating-from-react-native-webview,
  development, glossary, decisions).
