# Phase D item brief (shared by every Phase D agent)

You implement one or more approved items of the 2026-10-23 quality audit of minimal-rn-webview (a React Native WebView
package: TS in src/, Kotlin in android/, Swift in ios/). You are in your own git worktree; other agents work in other
worktrees at the same time, and the orchestrator merges your commits.

Setup, in your worktree root:
1. `git reset --hard quality-2026-10-23` (the worktree is fresh; nothing is lost). If that is refused, use
   `git switch -c pd-<your first item id> quality-2026-10-23`. Check `git log --oneline -1` shows the branch head.
2. `npm ci` in the root and in example/ (needs network: run those with the sandbox disabled).

Read: CLAUDE.md, docs/development.md, docs/glossary.md, docs/decisions.md; docs/audit/2026-10-23/00-plan.md section 7
(the Phase D rules); in docs/audit/2026-10-23/01-synthesis.md the rows for your items. The C1 verification reports
(docs/audit/2026-10-23/C1-*.md) hold the verified evidence and the smallest change for each source id that a row
lists: read the sections for your source ids. The B reports beside them give more detail if you need it.

The maintainer approved every S item and the synthesis's recommendation on every D item. Don't re-open them; if the
code at HEAD makes an item wrong or unnecessary, stop that item and say why in your final message.

Do the smallest diff that fully does each item, including callers, tests, vectors, fixtures and docs (docs/*.md,
docs/glossary.md, a docs/decisions.md section when a decision changes, CHANGELOG.md under Unreleased when the public
API changes, saying what breaks), and the generated files when their sources change (`npm run build:page-client`,
`npm run gen:platform-types`). Match the surrounding code's style and comment density. New non-trivial logic gets a
test that runs on a laptop where the item says so.

Checks, in your worktree, all green before you commit:
- `npm test -- --watchAll=false`, `npm run lint`, `npx knip`, `npx tsc --noEmit -p src/__tests__/tsconfig.json`,
  `(cd example && npx tsc --noEmit)`, `npm run prepare`.
- Kotlin touched: `(cd example && npx expo prebuild --platform android --no-install)` once, then
  `(cd example/android && ./gradlew :minimal-rn-webview:compileDebugKotlin :minimal-rn-webview:testDebugUnitTest)`,
  and `detekt --input android/src/main --config detekt.yml` (no new findings).
- Swift touched: the iOS app can't be built in your worktree. Run the `xcrun swiftc ... ios/Tests/main.swift` line from
  docs/development.md, `swiftlint lint` (no new findings), and type-check every other Swift change by reading it twice
  against the declarations it uses. The orchestrator builds iOS after merging and sends you any compile error.
- Don't run the on-device suites (the orchestrator does, on both platforms, after merging). If your item changes what a
  suite in example/harness.ts checks, update the suite.
- A lint hook may report problems in what you added when you finish: fix them, never by adding suppressions (the only
  exceptions are suppressions an item explicitly asks for).

Rules: don't touch .github/workflows/. A script under .github/scripts/ is .mts. Commit one item per commit, subject
line only (a body only for something significant, such as what breaks), no attribution or Co-Authored-By lines. Don't
push, don't open a PR, don't modify other branches.

Final message, nothing else: per item, the commit hash and subject, the files changed, what breaks, the checks you ran
and their result, and anything undone or uncertain (name Swift you couldn't compile).

## The waves (so you know which neighbouring items other agents do)

    Branch quality-2026-10-23 from audit-2026-10-23 @ 15246f1. One commit per item. Ask before PR.
    W1: [S-01] | [S-02, S-09, D6] | [S-04, S-07]           + D3 probe (urlTracking on mrw-api36) -> D3 doc/comment fix by orchestrator
    W2: [D4(b)+S-03+D4(a)] | [S-14, S-15] | [D8]
    W3: [S-05, D7] | [S-08] | [S-17]
    W4: [S-06] | [S-13 minus answer()] | [S-18 + D5 ESLint]  + Periphery --strict
    W5: [S-10 + D5 coerce] | [S-11] | [S-12]
    W6: [D9] | [D11] | [D10]                                 + D5 site disables (Kotlin view @Suppress, Swift view type_body_length/file_length) by orchestrator
    W7: [S-20 + D1 + D12 doc + D15] | [S-19 + D13 + D14] | [S-21]
    W8: [S-16] last; then 03-result.md
    No action: D2 (no seams without a named use), D16 (wait), Q10 (keep truncation), lizard (stays out).
    Reference devices: mrw-api37 on emulator-5556; iPhone 17 Pro iOS 26.5 1F008950-5A13-4456-AAC1-328EFA6F2F3A.
