---
name: migrate-from-react-native-webview
description: Migrate a React Native app from react-native-webview to react-native-minimal-webview, then verify the migration and report the behavior that changed. Use when asked to migrate, switch, replace or port react-native-webview, or to move an app's WebView to react-native-minimal-webview.
---

# Migrate from react-native-webview

Replaces every react-native-webview usage in an app with react-native-minimal-webview. It keeps what the app's users see,
and it reports each behavior that changes so a person decides it.

Read these pages from the docs site, which serves each as Markdown, instead of working from memory. Most
react-native-webview props have no prop of the same name here.

- Migration guide: https://rasmuskard.github.io/react-native-minimal-webview/guides/migrating-from-react-native-webview/index.md
- README: https://rasmuskard.github.io/react-native-minimal-webview/index.md (When to use something else, Install,
  Requirements)
- Every page: https://rasmuskard.github.io/react-native-minimal-webview/llms.txt

## 1. Check the app can move

Stop and tell the user if the app is a case in the README's "When to use something else", or if it can't meet the
minimums in Requirements.

## 2. Inventory

Read the migration guide in full first. Then list, with file and line:

- every import or require of `react-native-webview`, and each `WebView` it renders, with its props and ref calls
- `injectJavaScript`, `postMessage`, `onMessage` and every handler that reads `nativeEvent`
- `window.ReactNativeWebView` in page code: in this repo, in injected script strings, and in web projects the app loads
- Jest mocks of `react-native-webview`, `patches/` entries for it, and the `LSApplicationQueriesSchemes` (iOS) and
  `<queries>` (Android) entries added for schemes a page opens

## 3. Install

Follow Install in the README. Add `@react-native-minimal-webview/extensions` only if a prop maps to an extension in the
guide.

## 4. Migrate each WebView

Map each prop with the guide's tables and recipes. Where the guide shows the old behavior, keep it, so the app behaves
as before. Two exceptions, which you list in the report instead of applying:

- Anything that gives pages more access than this package's default: granting camera, microphone or location, opening
  messaging to more origins or to iframes, or `origins: ['*']` on a script that only the app's own pages need.
- A prop the guide doesn't list. Leave a `TODO(migration)` comment at it.

Where a new event carries different data than the old one, rewrite the handler instead of renaming it. For example,
`onDownload` gets a file that is already saved, so code that opened or fetched the old event's URL goes.

Set the bridge's `allowedOrigins` to the origins the app loads, never `*`. Pages that call `window.ReactNativeWebView`
keep working through `reactNativeWebViewMessages`, so don't edit web projects outside this repo.

## 5. Remove react-native-webview

Uninstall it, and delete its patches, its Jest mocks and the scheme entries the guide says to remove. With the package
gone, a leftover import fails to compile instead of passing silently.

## 6. Verify

Run each check and fix what fails until all pass. Don't report the migration done before then.

1. `grep -rn "react-native-webview" --exclude-dir=node_modules .` finds nothing outside lockfiles and changelogs.
2. The type check (`npx tsc --noEmit`, or the project's script) passes. It reports one unknown prop per `WebView`
   per run, so rerun it until it's clean.
3. The project's lint and test scripts pass.
4. The app builds: `npx expo export` at least. If the project can build natively here (`npx expo run:ios`,
   `npx expo run:android`, or its own scripts), do that too, and load each migrated screen if you can run the app.

In a JavaScript project the type check finds nothing, so walk every prop of each migrated `WebView` against the guide
by hand.

## 7. Report

End with:

- what changed, per file
- a table of every row in the guide's "Defaults that differ" and "Behavior that differs" that applies to this app,
  each with what you did: kept the old behavior (how), or left the new one for the user to decide (why)
- the props and access changes you left for the user, with their `TODO(migration)` locations
- page changes the user must make in web projects outside this repo
- each check from step 6 with its result, and any you couldn't run
