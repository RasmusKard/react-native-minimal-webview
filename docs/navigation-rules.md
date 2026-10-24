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
opening another app: no rule matches it, so it is blocked. Every field a rule sets must match, and in a list one
matching entry is enough.

## Actions

- `allow`: load in place, on iOS a tapped universal link too ([Universal links stay in place](decisions.md#universal-links-stay-in-place)).
- `block`: cancel.
- `external`: hand to the OS, or to `onOpenExternal` if you set it.
- `ask`: call `onNavigationRequest`, which answers `allow`, `block` or `external` within 1 s. Anything else, or no
  `onNavigationRequest`, is `block`.

`onNavigation` reports every decision, except one a [native hook](native-hooks.md) makes.

## Defaults

- With no rules (or `[]`), http(s) loads in place, `file:` is blocked, and every other scheme opens externally from the
  main frame and is blocked from a subframe.
- With rules but no match, or a matching rule with an unknown `action`, the result is `block`.
- `about:`, `blob:`, `data:` and `javascript:` always load in place.
- The `source` load, reloads and back/forward skip the rules. A redirect of the `source` load doesn't (on Android, a
  reload's or back/forward's redirect doesn't either).

## New windows

There is never a second WebView: a new window (`target=_blank`, `window.open`) that the rules allow loads in place, so
`window.opener` is unavailable. A new window to `data:`, `blob:`, `javascript:`, `about:` or `file:` is blocked whatever
the rules say; other schemes go through them. On Android a new window that doesn't navigate within 5 s
(`window.open('')`) is dropped. Why, and what to do for real popups:
[New windows load in place](decisions.md#new-windows-load-in-place).

## Platform differences

- **`ask` on Android** cancels the navigation, asks, and reissues it with `loadUrl` on `allow`: the reissued load loses
  the page's referrer policy and the gesture flag, and its redirect chain restarts. It works only for the main frame;
  for iframes it falls back to `block`. iOS holds the navigation and asks for any frame.
- **POST on Android** skips the rules: form posts and payment redirects always load. A form POST to `target=_blank`
  can't be captured, so it doesn't load; iOS loads it in place.
- **iframes on Android:** only navigations to non-http(s) schemes (`tel:`, `intent:`) are decided. Rules for http(s)
  iframes, the `mainFrame: false` ones, apply only on iOS.
- **`userInitiated`** is true on iOS only for a tapped link (`.linkActivated`). A `location.href` change or
  `window.open` from a click handler is false on iOS but true on Android (`hasGesture()`).
- **`intent:` links (Android)** are sanitised: browsable only, with no explicit component or selector. If no app
  handles one, its `S.browser_fallback_url` goes through the rules; the `intent:` itself is reported as `block`.
