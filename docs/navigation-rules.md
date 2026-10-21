# Navigation rules

The rules run natively: no JS round trip per navigation, and the UI thread never blocks. They are an ordered list, and
the first match wins:

```tsx
<WebView
  source={{ uri: 'https://example.com' }}
  navigationRules={[
    { host: ['example.com', '*.example.com'], action: 'allow' },
    { scheme: ['http', 'https'], mainFrame: false, action: 'allow' },
    { mainFrame: true, action: 'external' }, // everything else: other sites, tel: and mailto: links, new windows
  ]}
/>
```

`mainFrame: true` on the last rule keeps a subframe's own non-http(s) navigation (an ad iframe's app link) from
opening another app: no rule matches it, so it is blocked.

Every field a rule sets must match. `scheme`, `host`, `path` and `query` are lists, and one entry matching is enough:

| Field | Matches |
|---|---|
| `scheme` | Exact, case-insensitive: `['tel', 'mailto']` |
| `host` | Exact, or `*.example.com` for subdomains only (not `example.com` itself). Case, port, userinfo and a trailing dot are ignored |
| `path` | A plain prefix of the percent-encoded path: `/checkout` also matches `/checkouts` |
| `query` | A query parameter, percent-encoded as in the URL and case-sensitive: `gad_source` matches one with that name and any value, `utm_term=google` only that exact value |
| `mainFrame`, `newWindow`, `userInitiated` | true or false. A new window is a main-frame navigation |

## Actions

- `allow`: load in place. On iOS that includes a tapped universal link, which WebKit would otherwise open in the app that claims it; an `external` rule hands it to the app.
- `block`: cancel.
- `external`: hand to the OS, or to `onOpenExternal` if you set it.
- `ask`: call `onNavigationRequest`, which answers `allow`, `block` or `external` within 1 s. A late or missing answer counts as `block`, as does one still pending when another page commits. Without `onNavigationRequest`, `ask` blocks at once. A URL that `ask` allowed isn't asked again until the next page commits, so a redirect loop can't ask forever.

`onNavigation` reports every decision: `{ url, action, mainFrame, newWindow, userInitiated, rule }`.

## Defaults

- With no rules, http(s) loads in place, `file:` is blocked, and every other scheme opens externally from the main frame and is blocked from a subframe.
- With rules but no match, the result is `block`.
- `about:`, `blob:`, `data:` and `javascript:` always load in place.
- The `source` load, reloads and back/forward skip the rules. A redirect of the `source` load doesn't: it is decided like
  any other navigation (on Android, a reload's or back/forward's redirect too).

## New windows

There is never a second WebView: a new window (`target=_blank`, `window.open`) that the rules allow loads in place, so
`window.opener` is unavailable. A new window to `data:`, `blob:`, `javascript:`, `about:` or `file:` is blocked,
whatever the rules say, because it would load in the main frame; every other scheme goes through the rules as usual
(`mailto:` and `tel:` open externally by default). On Android a new window that doesn't navigate within 5 s (`window.open('')`) is dropped.

## Platform differences

- **`ask` on Android.** Android can't pause a navigation, so `ask` cancels it, asks, and reissues it with `loadUrl` on `allow`. The reissued load sends the page as the referrer under WebView's default policy (the page's own referrer policy is lost), loses the gesture flag, and its redirect chain restarts. `ask` works only for the main frame on Android; for iframes it falls back to `block`. iOS holds the navigation and asks for any frame.
- **POST on Android.** The rules never run for POST requests: form posts and payment redirects always load. A form POST to `target=_blank` can't be captured, so it doesn't load; iOS loads it in place.
- **iframes on Android.** Android only decides iframe navigations to non-http(s) schemes (`tel:`, `intent:` and so on). Rules for http(s) iframes, the `mainFrame: false` ones, apply only on iOS.
- **`userInitiated`.** On iOS it's true only for a tapped link (`.linkActivated`). A `location.href` change or `window.open` from a click handler is false on iOS but true on Android (`hasGesture()`).
- **`intent:` links (Android).** They're sanitised: browsable only, with no explicit component or selector. If no app handles one, its `S.browser_fallback_url` loads instead.
