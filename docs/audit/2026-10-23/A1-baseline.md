# A1 baseline: every section 3 tool re-run at 333f05f (audit-2026-10-23, 2026-10-23)

## Summary

1. The tree did not move: every section 3 number reproduces exactly (cloc 1710/1176/920, detekt 9, SwiftLint 5, Periphery 2, jscpd 0 clones, fan-in 12/14 and 8/13). `git diff b453623 HEAD` touches only configs, docs and 6 native comment lines.
2. Two things section 3 does not say: ESLint is green with 26 warnings (not 0), and the biggest Swift complexity hot spot (`PlatformSettings.coerce`, CCN 19 to 24) is invisible to SwiftLint because of `ignores_case_statements: true`, while detekt flags its Kotlin twin at 24.
3. All existing checks pass on this head: jest 199/199 (7 suites), JVM 11/11 (6 classes), Swift rules 79+53+2, tsc x2, knip, both `--check` generators, `npm run prepare`. Not run: Stryker, both runs (A5).

## Differences from section 3 (reported first)

None in any measured number. Notes on how section 3's wording relates to the tree:
- "measured at b453623": `.swiftlint.yml`, `detekt.yml`, `.periphery.yml` are new in a8636ff (PR #41), so section 3's tool numbers were taken with those configs, not b453623's tree.
  `git diff b453623 HEAD -- android ios src` is 6 comment edits (`GLOSSARY.md`/`ADR 0001` renamed to `docs/glossary.md`/`docs/decisions.md`) in `DocumentScope.kt:*`, `Hooks.kt`, `MinimalWebView.kt` and the Swift twins. Line counts of all 40 files match section 10.
- ESLint "0, green" is the exit code and error count; there are 26 warnings (A1-07).
- "76% native": 1710+1176 = 2886 of 3806 = 75.8% (Kotlin+Swift only); 76.9% when the 178 Objective-C/header lines count.
- "7 hand-written TS files, acyclic": confirmed by grep (`index`, `types`, `WebView`, `bridge/{protocol,endpoint,createBridge,pageClient}`); `types.ts:4,12` imports are `import type`. `createBridge.ts:1` imports types from `../types`, `types.ts` imports nothing back: no cycle.

## Results (commands from the repo root; raw output in `A1-*.txt` beside this file)

| Tool | Exact command | Result | Data file |
|---|---|---|---|
| cloc | `cloc --quiet --exclude-dir=__tests__,Tests,test --not-match-f='\.generated\.' src ios android/src/main` | Kotlin 14 files 1710 code; Swift 13 files 1176; TypeScript 7 files 920; Objective-C 2 files 168; Ruby 1 file 22; C/C++ Header 2 files 10; XML 1 file 2. SUM 40 files, 4008 code, 1009 comment, 562 blank | A1-cloc.txt |
| detekt | `detekt --input android/src/main --config detekt.yml` | exit 2, 14 files, 9 findings, debt 3h, 9 weighted issues (list below) | A1-detekt.txt |
| SwiftLint | `swiftlint lint` | exit 2, 13 files, "Found 5 violations, 2 serious" (list below) | A1-swiftlint.txt |
| Periphery | `periphery scan` (11 s: build cached) | exit 0, 2 warnings (list below) | A1-periphery.txt |
| ESLint | `npm run lint` | exit 0, 0 errors, 26 warnings: 15 `no-void`, 9 `prettier/prettier`, 1 `import/order`, 1 `@typescript-eslint/no-unused-expressions`; 0 from sonarjs | A1-eslint.txt |
| knip | `npx knip` | exit 0, empty output | A1-knip.txt |
| jscpd | `npx -y jscpd src ios android/src/main --ignore '**/__tests__/**,**/Tests/**,**/test/**,**/*.generated.ts' --min-tokens 50 --reporters console` | "Found 0 clones": Kotlin 14 files 34640 tokens, Swift 13 files 12053, tsx 1 file 3259, ts 5 files 3967, ObjC 2 files 2414, Ruby 1, c-header 1 | A1-jscpd.txt |
| lizard | `uvx lizard -l swift -l kotlin -l typescript -C 15 -L 60 -w src ios android/src/main` | exit 1, 5 warnings (A1-10): `src/__tests__/createBridge.test.ts:17` (len 69, a test), `ios/MinimalWebViewModule.swift:5 definition` (NLOC 64, CCN 11, len 78), `ios/PlatformSettings.swift:143 coerce` (NLOC 41, CCN 24), `MinimalWebViewNavigation.kt:17 (anonymous)` (len 157, a lizard misparse), `MinimalWebViewModule.kt:57 definition` (NLOC 82, CCN 12, len 109). Per-function dump without tests: 355 functions (Kotlin 197, Swift 121, TS 37) | A1-lizard.txt, A1-lizard-all.csv, A1-lizard-top.txt |
| Stryker | not run | see A5 (WebView.tsx). `npm run mutation` (src/bridge, 80% gate) also not run: the same checkout, so a second Stryker collides | none |
| jest | `npm test -- --watchAll=false` | exit 0, 7 suites, 199 tests, 1.5 s | A1-jest.txt |
| tsc | `npx tsc --noEmit -p src/__tests__/tsconfig.json`; `(cd example && npx tsc --noEmit)` | both exit 0, no output | A1-tsc.txt |
| build | `npm run prepare` | exit 0 (`rm -rf build && tsc`; `build/` is gitignored) | A1-prepare.txt |
| generated files | `node .github/scripts/build-page-client.mjs --check`; `node .github/scripts/gen-platform-types.mts --check` | both exit 0 | none |
| Kotlin JVM | `(cd example/android && ./gradlew :minimal-rn-webview:testDebugUnitTest --rerun)` | BUILD SUCCESSFUL; 11 tests, 0 failures: DocumentScopeTest 2, CrashLoopTest 1, HooksTest 3, MinimalWebViewClientsTest 2, ShowsSourceTest 1, NavigationRulesTest 2. The plain command printed UP-TO-DATE (cached), hence `--rerun` | A1-gradle-test.txt |
| Swift rules | `xcrun swiftc ios/NavigationRules.swift ios/OriginRules.swift ios/DocumentScope.swift ios/Tests/main.swift -o <scratch>/rules && <scratch>/rules` | exit 0: 79/79 navigation, 53/53 origin, 2/2 document scope | A1-swift-rules.txt |
| Fan-in | the loops in plan section 8 | Kotlin: `MinimalWebView` 12 of 14 files (not in `NavigationRules.kt`, `DocumentScope.kt`; counts its own file), then `DocumentScope` 5, then 3 each (`WebViewContext`, `PlatformSettings`, `NavigationRules`, `MinimalWebViewNavigation`, `InjectedScript`, `ChromeClient`), the rest 2 or 1. Swift: `MinimalWebView` 8 of 13 (3 of them are its own `+Navigation`, `+Dialogs`, `+Scripts`, plus itself; outside: `DelegateProxy`, `Hooks`, `Downloads`, `MinimalWebViewModule`), `DocumentScope` 4, `PlatformSettings` 3, `OriginRules` 3, the rest 2 or 1 | A1-fanin-kotlin.txt, A1-fanin-swift.txt |

detekt findings (all in `android/src/main/java/expo/modules/minimalwebview/`): `PlatformSettings.kt:35` apply cyclomatic 16/15 and cognitive 15/15; `PlatformSettings.kt:147` coerce cyclomatic 24/15; `NavigationRules.kt:81` matches 6 params (threshold 6); `requests/Downloads.kt:53` fetch cognitive 23/15; `MinimalWebView.kt:31` 20 functions (threshold 11); `MinimalWebViewModule.kt:57` definition 77 lines (max 60), cyclomatic 15/15, cognitive 19/15. Statistics: 2373 loc, 1710 sloc, 608 cyclomatic, 399 cognitive, 193 functions, 31 classes.
SwiftLint findings: `OriginRules.swift:27:48` large_tuple (error); `MinimalWebViewModule.swift:5:10` function_body_length 62 lines (error, limit 60); `NavigationRules.swift:78:18` function_parameter_count 6 (warning, limit 5); `MinimalWebView.swift:489:1` file_length 489 (warning, 400); `MinimalWebView.swift:4:1` type_body_length 318 (warning, 250).
Periphery findings: `ios/MinimalWebView+Navigation.swift:7:58` and `ios/MinimalWebView.swift:412:28`, "Unused parameter 'webView'".

Extra probes (not in section 3), for B3 and B4:
- SwiftLint with `ignores_case_statements: false` (temp config, not committed): adds `PlatformSettings.swift:143` coerce cyclomatic 19 (error). Nothing else changes.
- detekt with `ignoreSimpleWhenEntries: true` on `CyclomaticComplexMethod` (temp config): 8 findings; `MinimalWebViewModule.definition`'s cyclomatic clears; coerce drops 24 to 15 and is still flagged (detekt flags at equality).
- sonarjs cognitive-complexity at 10 over `src` minus tests (`A1-sonarjs-lower.txt`): `WebView.tsx:317` 14, `bridge/endpoint.ts:102` 13, `bridge/protocol.ts:50` 14; every other function is 7 or less (`createBridge.ts:82` is 7, the rest 5 or less). `nested-control-flow` at level 2: no findings (level 1 has 8, all in `bridge/`).
- lizard top by CCN without tests (`A1-lizard-top.txt`): Swift `coerce` 24, Swift `NavigationRules.match` 15, Kotlin `PlatformSettings.coerce` (misparsed as anonymous, 14), TS `protocol.ts:50 kindProblem` 13, Swift `decideNavigation` 13, Kotlin `NavigationRules.matches` 12. Only 3 functions have NLOC >= 30: the two module `definition`s and Swift `coerce`.

## Findings, ranked by impact

**A1-01. The biggest Swift hot spot is hidden.** `PlatformSettings.coerce` is the most complex function on both platforms (Kotlin detekt 24, Swift lizard 24). detekt flags the Kotlin one; SwiftLint stays silent on the Swift one because `.swiftlint.yml:5` sets `ignores_case_statements: true` (with it off: complexity 19, error). So "9 vs 5 findings" understates the Swift side by one, and the two tools disagree about the same logic. Evidence: `PlatformSettings.kt:147`, `ios/PlatformSettings.swift:143`, `.swiftlint.yml:5`, `A1-detekt.txt`. Quality 3, 4. Recommendation: simplify (make the tools agree: either `ignores_case_statements: false`, one more finding, or `ignoreSimpleWhenEntries: true` in detekt, which clears the `definition` cyclomatic finding too and leaves coerce at 15), then B4 decides fix or accept. S, confidence high. Breaks nothing; SwiftLint already exits non-zero.

**A1-02. `Downloads.fetch` has the highest cognitive complexity (23) and no unit test.** Evidence: `requests/Downloads.kt:53`, detekt. Quality 3, 4. Recommendation: split (HTTP request, size cap, error mapping) and test; the plan lists it as on-device only. M, confidence medium (the split is B3 and B4's call). Breaks: nothing outside `Downloads.kt` if kept private.

**A1-03. The two module `definition`s are the longest functions.** Kotlin 77 lines (detekt; lizard NLOC 82, length 109), Swift 62 lines (SwiftLint error severity, limit 60; lizard NLOC 64, length 78). They are the Expo Module DSL listing, so the length is a flat list, but both exceed the limit and the Kotlin one also has cognitive 19. Evidence: `MinimalWebViewModule.kt:57`, `MinimalWebViewModule.swift:5`. Quality 4. Recommendation: keep or split by feature (B4's question). S to M, confidence medium. Breaks: nothing public.

**A1-04. The view class is large on both platforms.** Kotlin `MinimalWebView` 20 non-private, non-override functions (detekt, limit 11), 507 lines; Swift `MinimalWebView.swift` 489 lines, class body 318 (limits 400 and 250); fan-in 12 of 14 and 8 of 13 while every other type is 5 or fewer. Evidence: `MinimalWebView.kt:31`, `ios/MinimalWebView.swift:4`, `A1-fanin-*.txt`. Quality 5, 4. Recommendation: document (aggregate root or accretion: B5 decides). M, confidence high on the numbers. Breaks nothing.

**A1-05. The 6-parameter rule matcher is mirrored in both languages.** Kotlin `NavigationRules.matches` (detekt 6 params, lizard CCN 12) and Swift `NavigationRules.matches` (SwiftLint 6 params) have the same signature shape, and both run on the shared vectors. Their callers `match` are the next most complex: Swift CCN 15 (lizard), Kotlin CCN 11. Evidence: `NavigationRules.kt:81,37`, `ios/NavigationRules.swift:78,41`. Quality 4, 5. Recommendation: simplify (one input struct on each side, the vectors pin behaviour). S, confidence medium. Breaks: the call sites in the clients, `NavigationRulesTest`, `ios/Tests/main.swift`.

**A1-06. Two unused parameters (Periphery).** `decideNavigation(_:in:decide:)` takes a `webView` it never reads (`ios/MinimalWebView+Navigation.swift:7`, one caller, `ios/MinimalWebView.swift:353`); `loadEnded(_:_:_:)` too (`ios/MinimalWebView.swift:412`, three callers, lines 400, 404, 408). Quality 4. Recommendation: delete the parameters. S, confidence high. Breaks: only those four call sites.

**A1-07. ESLint is not at zero.** `npm run lint` exits 0 with 26 warnings: 15 `no-void` (`src/WebView.tsx:212,275-278,298,523`, `bridge/createBridge.ts:94`, `bridge/pageClient.ts:52`, `bridgeTypes.test.ts:20,22`, 4 in `example/`), 9 prettier (6 in `.github/scripts/build-page-client.mjs`), 1 `import/order` (`example/test-pages/server.js:21`), 1 `no-unused-expressions` (`example/harness.ts:102`). 10 are fixable with `--fix`. Quality 3. Recommendation: simplify (`--fix`, then either configure `no-void` for fire-and-forget promises or change the 15 uses; `--max-warnings 0` ratchets it). S, confidence high. Breaks nothing at runtime.

**A1-08. One script is still `.mjs`.** `.github/scripts/build-page-client.mjs` (package.json `build:page-client`) against the plan's `.mts` rule and `gen-platform-types.mts`; it carries 6 of the prettier warnings. Quality 3. Recommendation: simplify (rename to `.mts`, update `package.json` and `docs/development.md`). S, confidence medium. Breaks: the CI `--check` step that names the file (`.github/workflows/` must not be edited in this audit, so list it for Phase D).

**A1-09. The tools' thresholds do not compare.** detekt flags at equality (`apply` cognitive 15/15, `definition` cyclomatic 15/15, `matches` 6/6 are findings); SwiftLint's `error: 15` and sonarjs's 15 allow 15. Three of the nine detekt findings sit exactly at the limit, one more is 16/15. Evidence: `A1-detekt.txt`, `detekt.yml:4-5`, `.swiftlint.yml:5`, `eslint.config.cjs:25`. Quality 3. Recommendation: document (one line in `docs/development.md`), before any ratchet. S, confidence high.

**A1-10. lizard is unreliable for Kotlin and unscoped.** It parses the Kotlin expression-bodied `coerce` as an anonymous CCN-14 function (real value 24) and a property getter as a 157-line anonymous function (`MinimalWebViewNavigation.kt:17`, a class body); the plan's command also lints `src/__tests__` (warning 1 of 5). Quality 3. Recommendation: document (use lizard for Swift and TS only, add `-x '*/__tests__/*' -x '*/Tests/*'`) or drop it from the baseline. S, confidence high.

**A1-11. TS production code is comfortably simple.** Highest sonarjs cognitive 14 (`WebView.tsx:317`, `protocol.ts:50`), 13 (`endpoint.ts:102`); highest lizard CCN 13 (`protocol.ts:50`); nesting at most 2 everywhere in `src` outside tests; 0 knip findings; 0 jscpd clones. Quality 4. Recommendation: keep. S, confidence high. Three functions are 1 to 2 below the limit of 15.

## Out of slice

- Stryker (`WebView.tsx` 65.8%, `src/bridge` 80% gate): A5.
- Lines and complexity per feature: A2. Members used per reference to the view class: A3.
- Whether each of the 14 findings is fixed or accepted, and the thresholds to adopt: B4, C2.
- `MinimalWebViewClients.kt:115-118` against the Document scope decision (section 2, Open): not touched.

## Questions only the maintainer can answer

1. Should the flat-dispatch exemption apply to both platforms (A1-01) or neither?
2. Is a warning-free ESLint (`--max-warnings 0`) a goal, or are the 15 `no-void` uses accepted style?
3. Keep lizard in the baseline despite A1-10, given detekt and SwiftLint cover the same ground?

```json
[
{"id":"A1-01","file":"ios/PlatformSettings.swift","line":143,"quality":3,"claim":"Swift coerce (CCN 19 to 24) is unreported because .swiftlint.yml ignores case statements; Kotlin twin is flagged at 24","recommendation":"simplify","size":"S","confidence":"high"},
{"id":"A1-02","file":"android/src/main/java/expo/modules/minimalwebview/requests/Downloads.kt","line":53,"quality":4,"claim":"Downloads.fetch cognitive complexity 23, highest in the codebase, no unit test","recommendation":"split","size":"M","confidence":"medium"},
{"id":"A1-03","file":"android/src/main/java/expo/modules/minimalwebview/MinimalWebViewModule.kt","line":57,"quality":4,"claim":"Module definition is 77 lines (Kotlin) and 62 lines (Swift, error severity); a DSL listing over both limits","recommendation":"keep","size":"M","confidence":"medium"},
{"id":"A1-04","file":"android/src/main/java/expo/modules/minimalwebview/MinimalWebView.kt","line":31,"quality":5,"claim":"View class: 20 functions (limit 11), Swift 489 lines and class body 318, fan-in 12/14 and 8/13","recommendation":"document","size":"M","confidence":"high"},
{"id":"A1-05","file":"android/src/main/java/expo/modules/minimalwebview/NavigationRules.kt","line":81,"quality":4,"claim":"The rule matcher `matches` takes 6 parameters in both Kotlin and Swift; Swift `match` has CCN 15","recommendation":"simplify","size":"S","confidence":"medium"},
{"id":"A1-06","file":"ios/MinimalWebView+Navigation.swift","line":7,"quality":4,"claim":"Periphery: unused webView parameter in decideNavigation and loadEnded (MinimalWebView.swift:412)","recommendation":"delete","size":"S","confidence":"high"},
{"id":"A1-07","file":"src/WebView.tsx","line":212,"quality":3,"claim":"ESLint exits 0 but has 26 warnings (15 no-void, 9 prettier, 2 other)","recommendation":"simplify","size":"S","confidence":"high"},
{"id":"A1-08","file":".github/scripts/build-page-client.mjs","line":1,"quality":3,"claim":"Script still .mjs while the plan and gen-platform-types.mts use .mts","recommendation":"simplify","size":"S","confidence":"medium"},
{"id":"A1-09","file":"detekt.yml","line":4,"quality":3,"claim":"detekt flags at equality, SwiftLint and sonarjs allow it; 4 of 9 detekt findings are at or 1 above the limit","recommendation":"document","size":"S","confidence":"high"},
{"id":"A1-10","file":"docs/audit/2026-10-23/A1-lizard.txt","line":1,"quality":3,"claim":"lizard misparses Kotlin (coerce as anonymous CCN 14, class body as 157-line function) and lints tests","recommendation":"document","size":"S","confidence":"high"},
{"id":"A1-11","file":"src/bridge/protocol.ts","line":50,"quality":4,"claim":"TS production code is simple: max sonarjs cognitive 14, max CCN 13, nesting <= 2","recommendation":"keep","size":"S","confidence":"high"}
]
```
