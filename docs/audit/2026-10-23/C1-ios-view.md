# C1 verification: ios-view (6 findings) @ 8c0c1ca

CONFIRMED 5 (B1-2, B1-8, B2-03, B3-08, B4-13), REFUTED 1 (B1-3), PLAUSIBLE 0.
Corrected numbers: B4-13's class body after the move is 247, not about 225, and the move makes the file 491 lines. B3-08 is size M, not S.
B1-2 and B1-3 contradict each other. If sharedCookies stays in Core (B1-2), S5 gets no in-package hook user (B1-3).

## B1-2: CONFIRMED (two of the three numbers are estimates)

- The glossary defines Core as "This package's own native code" (`docs/glossary.md:13-14`), and "an extension is a package
  that ships hooks" (`docs/glossary.md:23`). An in-package extension is therefore still Core, so none of the three moves
  shrinks it. The moves need seams that land in Core: S5 for sharedCookies, S2+S6 for pull-to-refresh, S3+S4 for downloads.
- The sharedCookies wiring today: `MinimalWebView.swift:31-32,70-71,117,124,133-143,233,258`, `MinimalWebViewModule.swift:22`
  and `src/WebView.tsx:102,126,358`. As a package-registered hook, it would need about 8 lines of registration, a gate
  (protocol 2, context 4, view about 8 in place of the 11 in `prepareLoad`) and a JS mapping into `hookOptions` (about 3).
  It would remove 7 lines of wiring. That nets about +6, which matches the claim.
- Pull-to-refresh: iOS `MinimalWebView.swift:24-30,109,122-123,414-415`; Android `PullToRefresh.kt` with
  `MinimalWebView.kt:72,129,192,210,366,374,400`. Download saving: `Downloads.swift`, plus the core hand-off
  at `MinimalWebView.swift:361-363,384-387` and `+Navigation.swift:21-26`. My rough recount of each, as an extension with
  its seams and registration on both platforms, is +32 to +34. "About +38" is within that range, but it can only be
  settled by writing the extension.
- Recipes: under the plan's consumer cost rule (`00-plan.md` §0), each consumer would write an Expo module. That costs
  more than the library pays once.
- **Smallest change:** none (keep). Size S. **Breaks:** nothing.

## B1-3: REFUTED (the "one seam" claim)

- The facts in the claim hold. `preparing` is a gate with one user: it is set and cleared only in `prepareLoad`
  (`MinimalWebView.swift:134-143`) and read at `:117`, and `cookies.prepare` (`SharedCookies.swift:29-39`) is the only
  thing it waits on.
- The claim that makes S5 unique does not hold, because other seams also have both a third-party use and a core-only
  implementation today:
  - S4: a hook that reads responses must take `decidePolicyForNavigationResponse`, and loses `http` errors and
    downloads (`docs/native-hooks.md:47-48`). The core's split already exists at `MinimalWebView.swift:361-373`.
  - S3: a third-party download hook is impossible on Android. "Android's download listener" is "don't touch"
    (`docs/native-hooks.md:72-73`), and the core's own listener is at `MinimalWebView.kt:150`.
  - S2: the core already owns a content wrapper that is swapped after a crash (`PullToRefresh.kt:21-22`,
    `MinimalWebView.kt:129,210,366`).
- The seam's shape: sharedCookies copies before *each* `source` load (`MinimalWebView.swift:126-130`), so a one-shot
  `context.holdLoads()` does not fit. It needs a per-load `context.beforeLoad { done in … }`.
- **Smallest change:** a per-load gate that also routes the core's own `cookies.prepare` through it. sharedCookies stays
  in Core and the gate is generic from day one. About 14 lines: Hooks.swift protocol 2, HookContext 4, and
  `prepareLoad` with a DispatchGroup (+5) and a once-guard (+2, because a double `done` makes `leave()` crash).
  Docs are +2. Size M.
- **Breaks:**
  - A new requirement on the public `WebViewContext` protocol (`Hooks.swift:50`) breaks any outside conformer. In the
    repo only `HookContext` conforms (`Hooks.swift:74`).
  - A gate that never calls `done` stalls every later prop change, because of `guard !preparing` (`:117`). This needs a
    timeout or a doc line.
  - It adds an iOS-only hooks API: Android has no equivalent, against quality 2's "reads the same in Swift and Kotlin".
  - No laptop test is possible: `MinimalWebView.swift` is not in the swiftc test build (`docs/development.md:11`).

## B1-8: CONFIRMED

- The hand-off path:
  - The didBecome selectors are not in `DelegateProxy.decisions` (`DelegateProxy.swift:44-52`), so the proxy forwards
    them to the core (`:27`).
  - The core sets `download.delegate = Downloads` when `onDownload` is set (`MinimalWebView.swift:385`,
    `Downloads.swift:33-35`), then calls every hook delegate (`MinimalWebView.swift:386`, `:327-329`).
  - A hook that assigns `download.delegate` there wins, because it is the later assignment.
- After that, `Downloads.files` gets no entry, so `core.download` is never emitted and `onDownload` is not called
  (`Downloads.swift:50,55-56`).
- `docs/native-hooks.md:43-51,72-74` does not say this.
- **Smallest change:** one sentence in `docs/native-hooks.md`'s Delegates bullet. It should say: iOS only, while
  `onDownload` is set, a delegate's `didBecome` may set `download.delegate`, and then `onDownload` gets nothing. Size S.
- **Breaks:** no code changes. The sentence makes the order at `MinimalWebView.swift:384-387` (core first, then the
  hooks) a public contract. It is also a documented iOS/Android asymmetry until S3 exists.

## B2-03: CONFIRMED

- iOS: the hooks are filtered by registered key (`MinimalWebView.swift:214`). A key in `hookOptions` that no hook is
  registered under is never looked at. Android behaves the same (`MinimalWebView.kt:142-143`).
- A later change does warn (`MinimalWebView.swift:453-454`, `MinimalWebView.kt:292-293`), but with a misleading reason
  ("added after the WebView was created") even when no hook exists for the key. A key that was there at creation but
  has no hook stays silent after a change, because `!enables(old[key])` is false.
- The only signal is `ref.hook` rejecting with `hook_not_handled` (`docs/native-hooks.md:56-57`).
- **Smallest change:** after `:214`, a 3-line loop that sends `core.warning` "hookOptions.<key>: no hook is registered
  under this key" for each enabling key not in `hookContexts`. On Android, about 2 lines, but only on the first
  creation (`hookKeys == null` at `:142`), or every crash re-warns. Plus one doc sentence at `docs/native-hooks.md:41-42`.
  Size S. It is an added warning, not a simplification.
- **Breaks:**
  - Nothing in the suites: every key the harness uses (`pageCounter`, `hookAuth`, `hookDialogs`, `example/harness.ts:2193-2226`,
    `example/App.tsx:140`) is registered on both platforms (`SampleExtensionModule.swift:10,24,28`, `.kt:19,33,37`).
  - `nativeContract.test.ts:192-195` and its iOS row accept any extra `"core.warning",` site with `["message": …]`.
  - A platform-only hook passed on both platforms will now warn on the other one.

## B3-08: CONFIRMED (size M, and "untested" means not tested on a laptop)

- The 60 s boundary: iOS keeps crashes with `now - t < 60` (`MinimalWebView.swift:424`). Kotlin keeps
  `t >= now - 60000`, which is `<= 60 s` (`MinimalWebView.kt:499`).
- The trailing slash: iOS `sameURL` only maps an empty path to "/" (`+Navigation.swift:114-121`, used by `onSource` at
  `MinimalWebView.swift:164-168`). Kotlin does `trimEnd('/')` (`MinimalWebView.kt:489`).
  - A swiftc experiment gives `sameURL("…/page", "…/page/") == false`, while `ShowsSourceTest.kt:17` expects true.
  - Effect: a crash on `…/page/` after `source` `…/page` reloads without the source's headers on iOS
    (`MinimalWebView.swift:430-432`).
- Kotlin tests both, with inline cases (`CrashLoopTest.kt`, `ShowsSourceTest.kt`). Swift does not:
  `MinimalWebView.swift` and `+Navigation.swift` are not in the swiftc build (`docs/development.md:11`). The on-device
  `crash` suite runs on iOS (`example/harness.ts:1048-1225`), but it cannot hit these edges.
- A shared vector can pin only part of this. Kotlin's `SAME_CRASH_MS` dedupe (`MinimalWebView.kt:498,506`) and the
  per-process count are Android by design (`docs/glossary.md`, Crash recovery), and iOS's html branch
  (`htmlCommit`, `:166`) has no Kotlin twin. So the vector holds the window/count cases with gaps ≥100 ms, and the
  URI-equality cases.
- **Smallest change:** about 50 lines in 6 files.
  - Move `sameURL` into `NavigationRules.swift`, and the guard into a pure `crashAllowsReload(_:now:)` in a file already
    in the swiftc build. A new file would need the swiftc line in `docs/development.md:11` and in the dead
    `.github/workflows/test.yml:34`, which is off-limits.
  - Pick one trailing-slash rule and one boundary.
  - Add `src/__tests__/vectors/recovery.json`. The symlinks `ios/Tests/vectors` and `android/src/test/resources/vectors`
    pick it up.
  - Add a loop in `ios/Tests/main.swift`, and switch the two Kotlin tests to read the vector.
  - Size M.
- **Breaks:** a behaviour change on whichever platform gives up its slash rule or boundary. `sameURL` also decides the
  "own load skips the rules" check (`+Navigation.swift:13`). Nothing public changes.

## B4-13: CONFIRMED (counts reproduced; two of its numbers are wrong)

- `swiftlint lint ios/MinimalWebView.swift` reports a file length of 489 and a class body of 318.
- I made a temp copy with lines 346-436 (the WKNavigationDelegate methods) in a same-file `extension MinimalWebView`.
  Its class body is **247**, not about 225. Moving `forward` and `failed` (`:326-344`) as well gives 232. The file
  becomes **491** lines, so "keep with file_length warning 490" would still warn. The warning must be ≥491 (500 is the
  error today, `.swiftlint.yml:8`).
- Private access from a same-file extension is allowed, and the moved methods still witness the `@objc` protocol for
  `DelegateProxy`'s `responds(to:)` (`DelegateProxy.swift:21,27`).
- The move leaves only 3 lines of margin under 250. The same type and state stay, and `// MARK: WKNavigationDelegate`
  (`:346`) already marks the section. The gain is to the lint number, not to reasoning.
- **Smallest change:** either config only (`type_body_length` warning 320 and `file_length` warning 490, 2 lines), or
  the move plus `file_length` warning 500. Both are size S. This is part of the D-tier threshold decision.
- **Breaks:** nothing. The `nativeContract.test.ts` emit-site regexes are scoped to the file (`:207-264`), and there are
  no callers.

```json
[
 {"id": "B1-2", "verdict": "CONFIRMED", "evidence": "Core = the package's own native code (docs/glossary.md:13-14,23), so an in-package extension is still Core and the seams land in Core. sharedCookies wiring MinimalWebView.swift:31-32,70-71,117,124,133-143,233,258 recounts to about +6 net as a hook. Pull-to-refresh and download saving recount to about +32 to +34, consistent with +38 but settled only by writing them. Recipes cost each consumer an Expo module (00-plan.md §0)", "smallest_change": "keep", "size": "S", "breaks": "nothing"},
 {"id": "B1-3", "verdict": "REFUTED", "evidence": "preparing is a one-user gate (MinimalWebView.swift:117,134-143; SharedCookies.swift:29-39), but S5 is not the one seam with a third-party use and an existing core-only implementation: S4 (native-hooks.md:47-48; MinimalWebView.swift:361-373), S3 (native-hooks.md:72-73; MinimalWebView.kt:150) and S2 (PullToRefresh.kt:21-22; MinimalWebView.kt:129,210,366) have both. The gate must run per source load (MinimalWebView.swift:126-130), not once. It conflicts with B1-2 keeping sharedCookies in Core", "smallest_change": "per-load context.beforeLoad gate that also routes the core's cookies.prepare (about 14 lines: protocol 2, context 4, prepareLoad +5, once-guard +2) plus 2 doc lines", "size": "M", "breaks": "new WebViewContext requirement (Hooks.swift:50) breaks outside conformers (in-repo only HookContext, Hooks.swift:74); a never-done gate stalls props (MinimalWebView.swift:117); iOS-only hooks API; no laptop test possible"},
 {"id": "B1-8", "verdict": "CONFIRMED", "evidence": "didBecome is not a decision (DelegateProxy.swift:44-52), so it goes to the core (:27). The core sets download.delegate (MinimalWebView.swift:385; Downloads.swift:33-35), then forwards to the hooks (MinimalWebView.swift:386,327-329), so a hook's assignment wins; onDownload then gets nothing (Downloads.swift:50,55-56). native-hooks.md:43-51,72-74 is silent", "smallest_change": "one sentence in docs/native-hooks.md Delegates bullet: iOS only, while onDownload is set; onDownload then not called", "size": "S", "breaks": "no code; makes the order at MinimalWebView.swift:384-387 a public contract; documented asymmetry with Android until S3"},
 {"id": "B2-03", "verdict": "CONFIRMED", "evidence": "MinimalWebView.swift:214 and MinimalWebView.kt:142-143 filter registered hooks by key, so an unregistered key is never examined. The later-change warning (MinimalWebView.swift:453-454; MinimalWebView.kt:292-293) gives a misleading reason and misses keys present at creation; only ref.hook's hook_not_handled signals", "smallest_change": "after MinimalWebView.swift:214, a 3-line core.warning loop for enabling keys with no context; Android 2 lines on first creation only (hookKeys == null, :142); 1 doc sentence at native-hooks.md:41-42", "size": "S", "breaks": "nothing in suites (harness keys registered both platforms: harness.ts:2193-2226, SampleExtensionModule.swift:10,24,28, .kt:19,33,37); nativeContract.test.ts:192-195 accepts it; platform-only hooks passed on both platforms now warn on the other"},
 {"id": "B3-08", "verdict": "CONFIRMED", "evidence": "iOS keeps crashes with now-t < 60 (MinimalWebView.swift:424), Kotlin <= 60 s (MinimalWebView.kt:499). iOS sameURL maps only an empty path (+Navigation.swift:114-121; swiftc: /page vs /page/ false), Kotlin trimEnd('/') (MinimalWebView.kt:489; ShowsSourceTest.kt:17 true). No Swift laptop test (development.md:11); the device crash suite (harness.ts:1048-1225) cannot hit the edges. Dedupe (MinimalWebView.kt:498) and html (MinimalWebView.swift:166) are platform-specific by design", "smallest_change": "move sameURL into NavigationRules.swift and a pure crashAllowsReload into an already-built file; pick one slash rule and one boundary; src/__tests__/vectors/recovery.json (window/count cases with gaps >=100 ms, URI equality); loop in ios/Tests/main.swift; Kotlin tests read it (about 50 lines, 6 files)", "size": "M", "breaks": "behaviour on whichever platform changes its slash rule or boundary; sameURL also decides own-load rule skipping (+Navigation.swift:13); no public API"},
 {"id": "B4-13", "verdict": "CONFIRMED", "evidence": "swiftlint: 489 lines, class body 318. A temp copy with :346-436 in a same-file extension: body 247 (not about 225; 232 with forward/failed), file 491, so warning 490 still fires (.swiftlint.yml:7-8). Private access from a same-file extension is fine; DelegateProxy responds(to:) unaffected (DelegateProxy.swift:21,27)", "smallest_change": "either .swiftlint.yml type_body_length warning 320 + file_length warning 490 (2 lines), or the move + file_length warning 500", "size": "S", "breaks": "nothing; nativeContract emit-site regexes are file-scoped (nativeContract.test.ts:207-264); 3-line margin after the move"}
]
```
