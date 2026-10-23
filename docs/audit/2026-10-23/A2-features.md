# A2: feature table (audit-2026-10-23 @ 333f05f)

## Summary

1. Core is 5,552 physical lines (Kotlin 2,359, Swift+ObjC 1,805, TS 1,388), up 674 (+13.8%) from 4,878 at 806d16f. 64% of the growth is four must-core rows (Hooks mechanism +236, Bridge +72, Crash recovery +66, Navigation +60); the movable rows (shared cookies, pull-to-refresh, downloads, warmUp) together grew +11.
2. No feature changed class letter. Only S1 (live hook options) of the six seams landed: it leaves shared cookies at (b)+(d) S5 and pull-to-refresh on Android at (b)+(d) S2, S6, and makes iOS pull-to-refresh a complete (c). S2 to S6 are still absent (evidence below).
3. Route: the repaired `feature-tree/run.sh` regenerates per-function metrics, and its map is only partly repaired, so the table is core-size.md's by-hand method made repeatable (`A2-attribution.py`); cognitive complexity comes from the tool's `metrics.tsv`.

## Route and method

- **Tool route, partial.** `feature-tree/run.sh` pointed at `eslint.config.cjs` (the only fix it needed; `feature-tree/bin/swift-complexity` was already there, no brew install) and runs in 5 s. Its function metrics (`feature-tree/out/metrics.tsv`: 692 functions, LoC and cognitive complexity per function) are fresh and are what the cog numbers below use. The map (`map/*.txt`) was not trustworthy: `verify.py` listed 213 of 623 items stale, three files gone (`ios/PullToRefresh.swift`, `ios/Permissions.swift`, `ios/MinimalWebView+Bridge.swift`). A scratch `relocate.py` moved 271 line numbers to the symbols' declarations; 49 items are still stale and 201 of 432 non-test functions have no ITEM line (many are nested closures the old map never listed), so `FEATURE_TREE.md` is regenerated but approximate (it says so in its header). Its tree is by public feature, not by core-size.md's rows, so it cannot give this table.
- **Table method.** Physical lines (comments, imports, blanks included) in `android/src/main`, `ios/` minus `Tests`, `src/` minus `__tests__` and `platform.generated.ts`: the same file set as core-size.md, and the same totals at 806d16f (1,999 / 1,643 / 1,236 = 4,878). `docs/audit/2026-10-23/A2-attribution.py` cuts each file into regions at anchor lines (a function, a comment block) and gives every line to one feature; `A2-regions.txt` lists every region with its line range, `A2-table.tsv` the numbers. Cog (sum of the cognitive complexity of the functions that start in the feature's regions, nested Kotlin/Swift functions counted in the outer one) is in brackets. A mixed function (the module `definition`, `applyProps`) goes whole to the feature of its first line.
- **Why two delta columns.** core-size.md's own ranges are lost (`attr.py` was in a scratchpad), so I ran the same anchors on 806d16f (`A2-table-806d16f.tsv`, `--old`). 14 of 20 rows come within 10% of the published figure; six do not (BFC by 4 lines, NS +42%, PS -16%, OTH -24%, GLUE +82%, DS +31%, marked `*`). Read the "same method" delta, not the "vs published" one, and treat the starred rows' deltas as low confidence.

## Table (lines, cog in brackets)

Classes as in core-size.md: (a) must be core, (b) built-in optional extension, (c) recipe or third-party extension on today's seams, (d) needs a missing seam.

| Feature | Kotlin | Swift/ObjC | TS | Total | 10-21 | vs published | same method | Class now |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Shared cookies (iOS) | 0 (0) | 81 (10) | 5 (0) | **86** | 82 | +4 | +11 | (b)+(d) S5 |
| Pull-to-refresh | 84 (9) | 10 (0) | 2 (0) | **96** | 131 | -35 | -28 | Android (b)+(d) S2, S6; iOS (c) |
| Downloads | 187 (49) | 117 (10) | 24 (0) | **328** | 274 | +54 | +28 | default (a) ~35; saving (b)+(d) S3, S4 |
| File upload (Android) | 96 (9) | 0 (0) | 14 (0) | **110** | 99 | +11 | +5 | (a); the `onFileRequest` path (c) |
| Fullscreen video (Android) | 106 (8) | 0 (0) | 8 (0) | **114** | 99 | +15 | +15 | (a) |
| Permissions | 101 (16) | 22 (4) | 17 (0) | **140** | 120 | +20 | +9 | Android default (a) ~10; JS path (c), kept |
| JS dialogs | 16 (0) | 76 (3) | 0 (0) | **92** | 88 | +4 | +4 | (a) iOS |
| Crash recovery | 106 (18) | 25 (5) | 8 (0) | **139** | 72 | +67 | +66 | (a) |
| warmUp / preconnect (Android) | 25 (0) | 0 (0) | 15 (2) | **40** | 44 | -4 | 0 | (c) possible, kept |
| Back-forward cache (Android)* | 12 (0) | 0 (0) | 0 (0) | **12** | 16 | -4 | 0 | (a) |
| Navigation rules + ask | 285 (65) | 210 (41) | 68 (1) | **563** | 532 | +31 | +60 | (a) |
| Ask / requestHandlers plumbing | 38 (1) | 31 (2) | 75 (15) | **144** | 122 | +22 | +21 | (a) |
| Navigation state (+ load events, refs)* | 181 (30) | 121 (13) | 272 (14) | **574** | 390 | +184 | +21 | (a) |
| Bridge + evaluate + injectedScripts | 185 (37) | 160 (17) | 534 (75) | **879** | 833 | +46 | +72 | (a), kept |
| Platform settings (apply)* | 153 (43) | 154 (44) | 86 (3) | **393** | 468 | -75 | -2 | (a) |
| get / call | 86 (34) | 291 (10) | 0 (0) | **377** | 368 | +9 | +6 | (a), kept |
| Hooks mechanism | 357 (35) | 262 (14) | 20 (0) | **639** | 418 | +221 | +236 | (a), the seam |
| DocumentScope* | 33 (0) | 36 (3) | 0 (0) | **69** | 51 | +18 | +2 | (a) |
| Expo module glue* | 75 (23) | 40 (9) | 77 (0) | **192** | 91 | +101 | +26 | (a) |
| Other core* | 233 (22) | 169 (24) | 163 (9) | **565** | 580 | -15 | +122 | (a) |
| **Total** | 2,359 (399) | 1,805 (209) | 1,388 (119) | **5,552** | 4,878 | +674 | +674 | |

Where the largest same-method deltas sit (from `A2-regions.txt` against the 806d16f run):
- **Hooks mechanism +236**: `Hooks.kt` 93 to 181 and `Hooks.swift` 60 to 131 (`onOptionsChange`, `onDocumentEnd`, `handle`, the context class: `Hooks.kt:90-100, 107-141`, `Hooks.swift:63-69, 74-130`); the view's hook code (Kotlin 38 to 65: `MinimalWebView.kt:60-66, 264-306`); `DelegateProxy.swift` 40 to 53.
- **Crash recovery +66**: Android +67 (39 to 106), iOS -3 (28 to 25): `pendingRecovery`, `processGone`/`recover`, the waiting-views companion, the crash-guard helpers (`MinimalWebView.kt:118-120, 352-408, 455-469, 492-507`), `MinimalWebViewClients.kt:217-225`, `MinimalWebViewModule.kt:73-77`.
- **Bridge +72**: TS +59 (`types.ts` bridge types 37 to 73 for the typed `createBridge<Methods, Events>`, `endpoint.ts` +16, `createBridge.ts` +12), iOS +15 (the 43-line `+Bridge.swift` and the bridge, evaluate and install-scripts code in the view became the 96-line `MinimalWebView+Scripts.swift`), Android -2.
- **Navigation +60**: Kotlin +27 and Swift +17 (`NavigationRules.kt` 75 to 103, `NavigationRules.swift` 83 to 104; for example the internal-scheme block for new windows, `NavigationRules.kt:39-46`), TS +16 (`types.ts` rule and event types).
- **Pull-to-refresh -28**: iOS fell from 31 to 10 lines (`PullToRefresh.swift` deleted; `MinimalWebView.swift:24-30` is a `UIRefreshControl` whose action calls the core's `reload()`); Android is 84.

## Seams (S1 to S6), status at 333f05f

| Seam | Status | Evidence |
|---|---|---|
| S1 live hook options | done | `MinimalWebView.kt:60-66, 284-296`, `Hooks.kt:90-91`; `MinimalWebView.swift:17-20, 446-457`; `creationKey` leaves `hookOptions` out (`WebView.tsx:416-420`) |
| S2 Android content wrapper | absent | core owns the layout: `MinimalWebView.kt:127-129` (refresher layout), `:206-215` (webView into `refresher.content`); no container member in `WebViewContext` (`Hooks.kt:69-101`) |
| S3 Android download listeners | absent | core sets the one listener at `MinimalWebView.kt:150-153`; a hook's own `setDownloadListener` (attach runs later, `:213`) would replace it; `call` refuses it (`PlatformSettings.kt:180`) |
| S4 iOS response-policy split | absent | `DelegateProxy.swift:44-52` lists `decidePolicyForNavigationResponse` as a decision: a hook that implements it owns it and the core's `onHttpError` and download default (`MinimalWebView.swift:356-374`) stop running |
| S5 iOS before-load gate | absent | `preparing` is private to the view: `MinimalWebView.swift:71, 117, 133-144` |
| S6 `context.reload()` | absent | neither context has it (`Hooks.kt:69-101`, `Hooks.swift:50-70`); the core's reload handles a POST `source` and the failed URL (`MinimalWebView.kt:241-251`, `MinimalWebView.swift:198-206`) |

Also deferred and still absent: `context.holdLoads()` (S5's public form) and decision hooks falling back to the core.

## Features whose class or seam list changed because live hook options and `ref.hook` exist

- **Shared cookies:** was (b)+(d) S5, S1; now (b)+(d) S5. The hook can toggle on `onOptionsChange` and clean up in its detach closure; it still cannot hold the first `source` load until the cookie copy is done.
- **Pull-to-refresh, Android:** was (b)+(d) S2, S1, S6; now S2, S6. Toggling no longer recreates the WebView.
- **Pull-to-refresh, iOS:** was "(c) today" but a toggle would have reloaded the page; now a complete (c): `onOptionsChange` for the prop, `onDocumentEnd(.crashed)` for the spinner reset (the core does that at `MinimalWebView.swift:109`), navigation-delegate observations for `didFinish`/`didFail` (core: `:415`). Only exactness is missing: a hook's `webView.reload()` is not the core's `reload()` for a POST source or a failed URL (S6).
- **get / call:** `ref.hook` + `context.handle` give an extension author a typed JS to native call with a reply (`MinimalWebViewModule.kt:147-156`), but a consumer with no native module still needs `call`. Stays (a); the consumer-cost rule decides it.
- **warmUp / preconnect:** unchanged (c). They are module functions with no view, so neither `hookOptions` nor `ref.hook` reaches them.
- Not changed: downloads (S3, S4), permissions, file upload, fullscreen, dialogs, crash recovery, navigation, bridge.

## Findings, ranked

1. **The growth is in rows that must be core; the movable rows did not grow.** +674 lines: Hooks +236, Bridge +72, Crash recovery +66, Navigation +60 (434, 64%); shared cookies, pull-to-refresh, downloads and warmUp together +11. So the shrink candidates cost the same as at the first audit while the hooks seam got 1.6 times bigger. Evidence `A2-table.tsv`, `A2-regions.txt`. Quality 1. Recommendation: document (B1 sizes the moves from this table). S. Confidence high for totals, medium for the row split. Breaks: nothing.
2. **The three deferred moves, re-sized.** Shared cookies 86 (`SharedCookies.swift` 64; 22 more in the view: `MinimalWebView.swift:31-32, 70-71, 117, 124, 130-144, 233, 258`; module `:22`; TS `WebView.tsx:102, 126, 358`, `types.ts:308-312`). Pull-to-refresh 96, of which iOS is only ~13 including its touches (`MinimalWebView.swift:24-30, 109, 122-123, 415`), so the move is an Android move: `PullToRefresh.kt` 76 plus about 10 touch lines (`MinimalWebView.kt:71-72, 127-129, 192, 210, 342, 366, 374, 400`). Download saving: `Downloads.kt` 174 + `Downloads.swift` 75 + 24 TS = 273 leave, about 35 stay (`MinimalWebViewNavigation.kt:86-97`, `MinimalWebView.kt:150-153`, `MinimalWebView.swift:361-368`, `MinimalWebView+Navigation.swift:21-26, 30-36`). Together about 455 lines leave, the same as the 453 core-size.md moved (82 + 131 + 240). Quality 1. Recommendation: document (hand to B1). S. Confidence medium (touch lines were grepped, not compiled). Breaks: nothing.
3. **Only S1 landed; the other five seams are the whole price of any move.** Table above. S2 to S6 were estimated at about 44 lines in total in core-size.md; no new seam has been added since. Quality 1, 5. Recommendation: add-seam (S2, S3, S4, S5, S6, each S) only if B1's packet picks a move; otherwise none. Confidence high that they are absent. Breaks: nothing today.
4. **Crash recovery doubled and is Android-heavy** (Kotlin 106, Swift 25, 139 together, was 73). Without it the app dies (`MinimalWebViewClients.kt:217-225` must return true), but the deferred recovery (`canRecover`, `waiting`, `inBackground`: `MinimalWebView.kt:380-390, 455-469`) is a policy on top of that. At 106 Kotlin lines it is as large as fullscreen video, and its logic is covered by `CrashLoopTest.kt` (the guard only) and on device. Quality 4, 3. Recommendation: keep; test (A5/B3 own the coverage). M. Confidence medium. Breaks: nothing.
5. **Hooks mechanism is the largest row (639 lines, 11.5% of Core):** Kotlin 357 = `Hooks.kt` 181 + 100 lines of callback forwarding in `MinimalWebViewClients.kt` (`:32-35, 94-105, 140-149, 164-168, 191-216, 226-237, 296-311, 340-354`) + 65 in the view + 11 in the module; Swift 262 = `Hooks.swift` 131 + `DelegateProxy.swift` 53 + 64 in the view + 14 in the module. The forwarding is the ~110 lines core-size.md finding 6 named (now ~100); the reflection cache is `Hooks.kt:149-181`. It is the seam, so (a); the open question is shape, not size. Quality 1, 5. Recommendation: keep (B5 judges the forwarding table). S. Confidence high. Breaks: nothing.
6. **Complexity is in a handful of functions, all in kept rows.** Cog 12 or more (eleven functions): `Downloads.fetch` 23 (`Downloads.kt:53`), module `definition` 19 (`MinimalWebViewModule.kt:57`), Swift `PlatformSettings.coerce` 18 (`PlatformSettings.swift:143`), `PlatformSettings.apply` 15 on both platforms (`PlatformSettings.kt:35`, `PlatformSettings.swift:26`), `onHookEvent` 14 (`WebView.tsx:317`), `kindProblem` 14 (`protocol.ts:50`), Kotlin `PlatformSettings.set` 14 (`:108`), `NavigationRules.match` 13 (`NavigationRules.kt:37`) and 12 (`NavigationRules.swift:41`), `receive` 13 (`endpoint.ts:102`). Downloads, Platform settings and Navigation rows carry 59, 90 and 107 cog in total. These agree with A1's detekt list. Quality 4. Recommendation: document (B4 picks fix or threshold). S. Confidence high.
7. **Physical lines overstate the code by about 46%.** Core is 5,552 physical lines but 3,806 code lines by cloc (plan section 3: 1,710 + 1,176 + 920), so 31% of the lines are comments, blanks and imports; the decisions-in-comments style (glossary, `docs/decisions.md`) is part of that. Comparing with `sample-extension` (86 / 103 / 17 lines) is only fair on one measure. Quality 3. Recommendation: document (B1 states the measure it uses). S. Confidence high. Breaks: nothing.
8. **The feature-tree map drifted by a third in 59 commits and has no coverage check.** 213 of its 623 items were stale (49 after `relocate.py`). `verify.py` only checks that an item's line still names its symbol; nothing lists functions without an item (201 of 432 non-test functions, many of them nested closures the old map never listed). Quality 3. Recommendation: simplify (keep only `metrics.tsv` and this script, or add the missing-item check) or delete. M. Confidence medium. Breaks: nothing shipped (`feature-tree/` is gitignored).

## Out of slice

- `docs/development.md` and `CLAUDE.md` do not mention `feature-tree/` or this script; nothing in the repo points at the deleted `PullToRefresh.swift`, `Permissions.swift`, `MinimalWebView+Bridge.swift` (grep of docs, README, ROADMAP, CHANGELOG, `.github`: none).
- The Document-scope open question (Chromium `onPageStarted` at commit, `MinimalWebViewClients.kt:115-120`) sits in the NS row; B3/B4 own it.

## Questions for the maintainer

1. For B1 and the final synthesis, "Core size" is physical lines (published, kept here) or code lines (cloc)? The two differ by 46%, and the extension yardstick should use the same one.
2. Is `feature-tree/` still wanted? Keeping it means fixing the 49 stale items by hand, adding items for the new functions, and a coverage check; dropping it leaves `metrics.tsv` plus `A2-attribution.py`.

```json
[
{"id":"A2-1","file":"docs/audit/2026-10-23/A2-table.tsv","line":1,"quality":1,"claim":"Core grew 674 physical lines in 59 commits; 64% is Hooks, Bridge, Crash recovery and Navigation, the movable rows grew 11","recommendation":"document","size":"S","confidence":"high"},
{"id":"A2-2","file":"ios/MinimalWebView.swift","line":24,"quality":1,"claim":"The three deferred moves re-sized: shared cookies 86, pull-to-refresh 96 (iOS only about 13), download saving about 273 leaving and about 35 staying","recommendation":"document","size":"S","confidence":"medium"},
{"id":"A2-3","file":"android/src/main/java/expo/modules/minimalwebview/Hooks.kt","line":69,"quality":5,"claim":"Only S1 of S1 to S6 exists; S2 to S6 are absent and no (d) row became (c)","recommendation":"add-seam","size":"S","confidence":"high"},
{"id":"A2-4","file":"android/src/main/java/expo/modules/minimalwebview/MinimalWebView.kt","line":352,"quality":4,"claim":"Crash recovery doubled to 139 lines, Android 106 against iOS 25, tested only by crashAllowsReload and on device","recommendation":"test","size":"M","confidence":"medium"},
{"id":"A2-5","file":"android/src/main/java/expo/modules/minimalwebview/MinimalWebViewClients.kt","line":94,"quality":1,"claim":"Hooks mechanism is the largest row at 639 lines; about 100 Kotlin lines are per-callback forwarding","recommendation":"keep","size":"S","confidence":"high"},
{"id":"A2-6","file":"android/src/main/java/expo/modules/minimalwebview/requests/Downloads.kt","line":53,"quality":4,"claim":"Cognitive complexity of 12 or more sits in eleven functions in kept rows, Downloads.fetch 23 and the module definition 19 the highest","recommendation":"document","size":"S","confidence":"high"},
{"id":"A2-7","file":"docs/audit/2026-10-23/A2-attribution.py","line":1,"quality":3,"claim":"Physical lines (5,552) are 46% above cloc code lines (3,806); comparisons with the extension yardstick need one measure","recommendation":"document","size":"S","confidence":"high"},
{"id":"A2-8","file":"feature-tree/verify.py","line":1,"quality":3,"claim":"The feature-tree map had 213 stale items (49 after a repair) and no check for functions without an item (201 of 432 non-test)","recommendation":"simplify","size":"M","confidence":"medium"}
]
```
