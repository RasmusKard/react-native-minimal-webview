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

Stop and tell the user if the app runs on the old architecture, Windows, macOS or web, or only in Expo Go. The package
supports none of those.

Compare the app's iOS deployment target and Android `minSdkVersion` with the minimums in Requirements. An app whose
config sets neither has the defaults of its Expo SDK. If either is lower, stop and ask before you raise it: raising it ends the app's support for those OS versions, and that is the
user's decision. Name the versions it would drop.

## 2. Inventory

Read the migration guide in full first. Then list, with file and line:

- every import or require of `react-native-webview`, and each `WebView` it renders, with its props and ref calls
- `injectJavaScript`, `postMessage`, `onMessage` and every handler that reads `nativeEvent`
- `window.ReactNativeWebView` in page code: in this repo, in injected script strings, and in web projects the app loads
- Jest mocks of `react-native-webview`, `patches/` entries for it, and the `LSApplicationQueriesSchemes` (iOS) and
  `<queries>` (Android) entries added for schemes a page opens

A search for the package name misses two kinds of usage. Read every prop of each `WebView` and follow each one to
its source to find them:

- a helper that returns WebView props, which the app spreads or reads a prop from (`Sentry.sentryWebViewProps()`)
- a library that takes the WebView ref and calls `postMessage` or `injectJavaScript` on it itself

Last, list the app's workarounds for react-native-webview bugs, each with the reason its comment, linked issue or
commit gives: every hunk of the patch, a reload or navigation done through `injectJavaScript`, a header or prop set
on one platform only, a remount that stands in for a reload.

## 3. Install

Follow Install in the README. Add `@react-native-minimal-webview/extensions` only if a prop maps to an extension in the
guide.

## 4. Migrate each WebView

Map each prop with the guide's tables and recipes. Where the guide shows the old behavior, keep it, so the app behaves
as before. Two exceptions, which you list in the report instead of applying:

- Anything that gives pages more access than this package's default: granting camera, microphone or location, opening
  messaging to more origins or to iframes, `origins: ['*']` on a script that only the app's own pages need, or access to
  local files.
- A prop that neither the guide's tables nor the platform API page it links covers. Leave a `TODO(migration)` comment
  at it.

For "Defaults that differ", start from the guide's one-object example and take out each setting the app sets itself.
Don't add the rows that example leaves out.

Where a new event carries different data than the old one, rewrite the handler instead of renaming it. For example,
`onDownload` gets a file that is already saved, so code that opened or fetched the old event's URL goes.

Where a ref call now returns a promise, handle its rejection the way the app handles its other errors, never with an
empty `catch`.

For each workaround in the inventory, find what the docs say about the bug it works around. Remove a workaround in
the app's own code only where they say this package doesn't have the bug, or does itself what the workaround did.
Keep it otherwise. A patch hunk can't be kept, since step 5 deletes the patch: map what it added as you would a prop,
and report what has no counterpart. List every workaround in the report.

Set the bridge's `allowedOrigins` to the origins of the pages whose messages the app acted on before, never `*` and
never every site the WebView can show. Pages that call
`window.ReactNativeWebView` keep working through `reactNativeWebViewMessages`; don't edit web projects outside this
repo. What the app sends them now waits for the page's `DOMContentLoaded`: report it for each page that waits for a
reply.

## 5. Remove react-native-webview

Uninstall it, and delete its patches, its Jest mocks and the scheme entries the guide says to remove. With the package
gone, a leftover import fails to compile instead of passing silently.

## 6. Verify

Run each check and fix what fails until all pass. Don't report the migration done before then.

1. `git grep -n "react-native-webview"` finds nothing outside lockfiles, changelogs and
   files that name the package without using it (a vendored dependency preset). List those in the report.
2. The type check (`npx tsc --noEmit`, or the project's script) passes. It reports one unknown prop per `WebView`
   per run, so rerun it until it's clean.
3. The project's lint and test scripts pass.
4. The app builds: `npx expo export` at least. If the project can build natively here (`npx expo run:ios`,
   `npx expo run:android`, or its own scripts), do that too.
5. If you can run the app, exercise each migrated screen on both platforms. A screen that paints proves only the
   first load. Do each of these that the screen has, and read the result from the page or the app's logs:
   - a message from the page to the app, and one from the app to the page
   - one navigation for each outcome the rules have: loads in place, opens externally, goes to `onNavigationRequest`
   - back, after a link tap
   - a reload, and pull-to-refresh
   - every way the app remounts or reloads the `WebView` itself

In a JavaScript project the type check finds nothing, so walk every prop of each migrated `WebView` against the guide
by hand.

## 7. Report

End with:

- what changed, per file
- the OS versions the app no longer supports, if the minimums were raised
- a table of every row in the guide's "Defaults that differ" and "Behavior that differs" that applies to this app,
  each with what you did: kept the old behavior (how), or left the new one for the user to decide (why)
- the props and access changes you left for the user, with their `TODO(migration)` locations
- each workaround from the inventory: removed (with the docs line that allows it) or kept
- page changes the user must make in web projects outside this repo
- each check from step 6 with its result, and any you couldn't run: name every step 6.5 action that was not exercised
  on a device, per platform
