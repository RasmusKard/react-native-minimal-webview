# Type Alias: IOSSettings

> **IOSSettings** = `object`

WebKit settings by Objective-C property name, set with Key-Value Coding, so any public property works, including ones
this package has never heard of: `{ scrollView: { bounces: false } }`. The keys the SDK headers list autocomplete,
with their `@since`. A value must fit the property's type: enums and option sets by raw value
(`WK.DataDetectorTypes.link`), structs as objects (`contentInset: { top, left, bottom, right }`), a `UIColor` as
`#rrggbb` or `#rrggbbaa`, an `NSURL` as a string, `websiteDataStore` as `'default'` or `'nonPersistent'`. A key that
doesn't fit, or a private (`_`) one, is skipped with a warning; nothing here can crash the app. A root's `@default`
keys are the package's, and yours go over them. Read one back with the ref's `get('scrollView.bounces')`.

## Platform

ios

## See

https://github.com/RasmusKard/minimal-rn-webview/blob/main/docs/examples.md#platform-settings

## Properties

### configuration?

> `optional` **configuration?**: [`SettingsRoot`](SettingsRoot.md)\<[`IOSSettingKeys`](IOSSettingKeys.md)\[`"configuration"`\]\>

`WKWebViewConfiguration`: read once, when the WKWebView is created; a change recreates the WebView (the page
reloads and the navigation state starts over). The default lets a `<video playsinline>` play inline.

#### Default

```ts
{ allowsInlineMediaPlayback: true }
```

***

### preferences?

> `optional` **preferences?**: [`SettingsRoot`](SettingsRoot.md)\<[`IOSSettingKeys`](IOSSettingKeys.md)\[`"preferences"`\]\>

`WKPreferences` (`configuration.preferences`), live.

***

### scrollView?

> `optional` **scrollView?**: [`SettingsRoot`](SettingsRoot.md)\<[`IOSSettingKeys`](IOSSettingKeys.md)\[`"scrollView"`\]\>

Its `UIScrollView`, live.

***

### webpagePreferences?

> `optional` **webpagePreferences?**: [`SettingsRoot`](SettingsRoot.md)\<[`IOSSettingKeys`](IOSSettingKeys.md)\[`"webpagePreferences"`\]\>

`WKWebpagePreferences` (`configuration.defaultWebpagePreferences`), live from the next navigation.

***

### webView?

> `optional` **webView?**: [`SettingsRoot`](SettingsRoot.md)\<[`IOSSettingKeys`](IOSSettingKeys.md)\[`"webView"`\]\>

The `WKWebView`, live.

#### Default

```ts
{ customUserAgent: null, inspectable: __DEV__ }
```
