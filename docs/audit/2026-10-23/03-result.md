# Quality review result: quality-2026-10-23 (2026-10-23)

Phase D on branch `quality-2026-10-23`, cut from `audit-2026-10-23` at 15246f1: 46 commits, one item per commit. The
maintainer approved every S item and the synthesis's recommendation on every D item. Each of the eight waves passed the
laptop set (jest, ESLint, knip, both `tsc`, `prepare`, the Kotlin JVM tests, the swiftc rule tests, detekt, SwiftLint,
Periphery, the Stryker gate) and all 20 on-device suites on Android (mrw-api37, WebView 149) and iOS (iPhone 17 Pro,
iOS 26.5). The final tree also passes 20/20 on mrw-api36 (WebView 133), with the known pre-146 limits as INFO.

## The five verdicts, after

| # | Quality | Before (01-synthesis) | After |
|---|---|---|---|
| 1 | Minimal core | pass with items (decisions) | **pass**. Every Core feature keeps a reason; the three deferred moves are closed in `docs/decisions.md` (D1, D2). Code lines (cloc, tests and generated files excluded): Kotlin 1,710 to 1,757, Swift 1,176 to 1,218, TS 920 to 924, the growth being `Asks`, `Recovery.swift`, the redirect loop that replaced OkHttp, and the S-05 warning. The direct `react-android` dependency is gone (D6). |
| 2 | Good interfaces | pass with items | **pass**. Both interface bugs fixed (S-01: `ref.hook` rejects `unavailable` during the Android rebuild; S-04: iOS `emit`/`ask` hop to main) and the silent `hookOptions` key warns (S-05). The hooks API differs only by the platform lists (D7 removed `context.activity` and the detach reason). Kotlin's view, rules and records are `internal` (S-06); a hand-made `Bridge` no longer type-checks (S-14). The confirmed doc drift is fixed (S-20, S-21, D15); iOS cookies pass through `call` (D8). |
| 3 | Easily maintainable | fail, narrowly | **pass**. Native files with a laptop test: Kotlin 542 lines (was 82), Swift 313 (was 108): asks, crash recovery, the download fetch and cap, platform settings (JVM, and Mac Catalyst for Swift), the hook override table, besides the matchers. `npm test` fails on a stale generated file and `npm run check` runs the laptop set (S-18). detekt 9 to 0, SwiftLint 5 to 0, Periphery 2 to 0, ESLint 26 warnings to 0, and each now fails on any finding (D5). The Stryker gate covers `WebView.tsx` and `refStore.ts` (WebView.tsx 65.8% to 91.0%; the gate 89.7%, D10). jest 199 to 235 tests, JVM 11 to 24, swiftc cases 134 to 151 plus 37 Catalyst. |
| 4 | Easy to reason about | pass with items | **pass**. Of the 15 complexity findings, 13 were fixed by local changes (S-08 to S-13, D5's `coerce`); the two view classes' size checks are disabled at the site, with the aggregate-root section as the reason. The walkthrough bugs are fixed (S-01, S-02, S-03) or documented (D12), the unwritten invariants got their comments (S-21, D14), and the pre-146 commit claim is settled on WebView 133 (D3). |
| 5 | Decoupled | pass with items | **pass**. The ask registry (`Asks`, D4b) and the file chooser (`FileUpload`, S-12) left the views: the Kotlin view went from 20 to 14 functions. `docs/decisions.md` says what belongs to the aggregate root (D4a). The hand-mirrored cross-layer values are pinned in `nativeContract.test.ts` (S-16; 27 one-literal probes each fail their pin), and the two cross-platform drifts have shared vectors (S-13 bare schemes, D9 recovery). |

## S items: all 21 merged

| Item | Commit | Note |
|---|---|---|
| S-01 recovery window | 258b10f | |
| S-02 download event after a crash | cdced2f | |
| S-03 hook ask after close | 328fbab | built on D4(b)'s `Asks` |
| S-04 iOS emit/ask on main | 9e2ef2f | |
| S-05 unclaimed `hookOptions` key warns | 2ce3853 | |
| S-06 visibility | 55d0a89 | |
| S-07 deprecated client variants | f1b7b20 | a compat subclass overriding only the 4-argument `onReceivedError` is still missed (an observation; a 5th entry) |
| S-08 module definitions | 712fd54, 9198a69 | Swift also moved `navigate` and `evaluate`, to clear the 40-line warning |
| S-09 `copyCapped` and its test | 45f6e40 | |
| S-10 `PlatformSettings` and its JVM test | 72cca24 | |
| S-11 matcher `Parts` | 8f2069d | |
| S-12 `FileUpload` owns the chooser | 12db497 | |
| S-13 Swift cleanups, bare schemes | 4d35380 | its `answer()` part dropped: D4(b) superseded it |
| S-14 typed `Bridge` | 96df1ad | |
| S-15 bridge glue tests | a394f0a, 031c8e9 | |
| S-16 value pins | 45cda5e | no mismatch found between the layers |
| S-17 `refStore.ts` | 6840184 | |
| S-18 `pretest`, `check`, `.mts` | 881c044 | |
| S-19 sample extension | 9a1c9ab, 7be0515 | |
| S-20 user docs | 56f27ec | |
| S-21 dev docs and comments | 16f01f3 | the `MinimalWebView.kt` detach comment dropped: D7 removed the comment it corrected |

## D items, as recommended

D1, D2 and D16 recorded in `docs/decisions.md` and ROADMAP (f10c127): the three stay in Core; S2 and S6 aren't added;
S3, S4, S5, `context.core` and a cancellable hook ask wait for a named use. D3: "at commit", from a WebView 133 probe
(886e032). D4: (a) 42930b5, (b) 5aa871d. D5: ESLint 0de0efa, detekt `coerce` a0ebd1a, the site disables and SwiftLint
`strict` 14a9035 (reasons e355b33), Periphery `strict` 5d2adf4, SwiftLint's body-length error 60 to 54 b320456. D6:
option (b), the gradle line could go entirely (e30ee91). D7 63cc998. D8 6497244. D9 3ea3e64. D10 ecbb1ef. D11
2f6b26d (and 2dfd864, the podspec now excludes `ios/Tests` recursively). D12 documented in S-20. D13 a7d352b: Android
ends the Document before `context.url` moves, confirmed on both platforms and on WebView 133. D14 7770615. D15 660c751.
Q10 (1.5 for an integer setting) keeps today's truncation; lizard stays out.

## What breaks (for the PR)

- `ref.hook` during the Android rebuild rejects `unavailable` (was `hook_not_handled`); `goBack`/`goForward`/`stop` do
  nothing in that window.
- Hooks (Android): `context.activity` and the detach closure's reason are gone; a hook overriding one of four deprecated
  client variants now gets that callback; Kotlin that names `MinimalWebView`, `NavigationRules`, `WebViewSource` or
  `InjectedScript` no longer compiles.
- iOS: bare-scheme URLs (`about:`, `myapp:`) are decided as on Android; crash recovery treats `/page` as `/page/` and
  counts a crash exactly 60 s back; an off-main hook `ask` answers on main.
- A hand-made `Bridge` no longer type-checks. A `hookOptions` key no hook claims warns. iOS `call` rejects a `{ data }`
  that isn't base64. Android downloads refuse any redirect hop that leaves https (OkHttp compared with the first URL).
- Tooling: `npm test` runs the generated-file checks first; ESLint, SwiftLint, Periphery and detekt fail on any finding.

## Open, not done

- `.github/workflows/test.yml` is stale (off-limits, no CI credits): its swiftc line lacks `Asks.swift` and
  `Recovery.swift`, and it runs `build-page-client.mjs`, now `.mts`.
- The lint hook's jscpd reports `ios/MinimalWebView.swift`'s three WebKit load-end delegate methods as a clone. It is on
  main too (the hook ignores identifiers), and restructuring them doesn't clear it; left as is.
- Unverified, seen while working: Swift `PlatformSettings`' `applied` cache compares with `isEqual:`, so `true` and `1`
  may count as unchanged (D11); the iOS crash reload may skip the shared-cookie copy (synthesis caveat).
- iOS `dialogs` stalled once in wave 3 and passed on its rerun. mrw-api37 runs only with `-no-window` on this host
  (docs/development.md says so).
- docs/development.md is true at the head: its check commands ran in the final checks; the AVD and sample-extension
  lines were run by the S-21 agent.
