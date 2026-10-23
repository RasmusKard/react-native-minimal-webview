---
status: accepted
---

# Universal links stay in place

On iOS, `decisionHandler(.allow)` for a tapped link to another host lets WebKit hand the URL to an installed app that
claims it as a universal link, and the WebView never sees it again. Android's WebView never hands off App Links
itself. react-native-webview answers plain `.allow`, so its apps inherit the hand-off on iOS only, with no way to stop
it: the two platforms behave differently for the same rule. Decided 2026-10-22 (first shipped in 7eb9363): on iOS
`allow` answers WebKit's private `_WKNavigationActionPolicyAllowWithoutTryingAppLink`, `.allow.rawValue + 2`, as
Firefox for iOS does, so a tapped universal link loads in the WebView, as on Android. Hand-off is an explicit
per-host `external` rule, which opens the URL through the OS resolver on both platforms (`UIApplication.open`,
`Intent(ACTION_VIEW)`), and that is where the claiming app gets it.

## Risks

- Private API: App Store review could object to the value, though it is a raw enum number, not a selector or symbol.
- If WebKit renumbers or drops it, the fallback is plain `.allow` and the hand-off comes back. It is one constant,
  `allowInPlace` in `MinimalWebView+Navigation.swift`.

## Considered and rejected

- Hand-off by default (plain `.allow`): iOS and Android would split on the same rules, and no rule could keep a
  claimed host in place on iOS.
