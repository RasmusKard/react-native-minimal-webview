# Type Alias: AndroidSettings

> **AndroidSettings** = `object`

Android settings by setter name without `set`, applied by reflection, so any public setter works, including ones a
newer SDK or androidx.webkit adds: `{ settings: { textZoom: 120 }, webView: { overScrollMode: 2 } }`. The keys the
SDK lists autocomplete, with their `@since`; the constants are in `Android` (`Android.WebSettings.LOAD_NO_CACHE`). A
key with no public setter for the value's type, or one this device's WebView lacks, is skipped with a warning;
nothing here can crash the app. A root's `@default` keys are the package's, and yours go over them. Read one back
with the ref's `get('settings.textZoom')`.

## Platform

android

## See

https://github.com/RasmusKard/react-native-minimal-webview/blob/main/docs/examples.md#platform-settings

## Properties

### settings?

> `optional` **settings?**: [`SettingsRoot`](SettingsRoot.md)\<[`AndroidSettingKeys`](AndroidSettingKeys.md)\[`"settings"`\]\>

`WebSettings` setters, then static `WebSettingsCompat` ones. Each new WebView starts with `javaScriptEnabled`,
`domStorageEnabled`, `supportMultipleWindows` and `builtInZoomControls` on; `allowFileAccess`,
`allowContentAccess`, `displayZoomControls` and `downloadFaviconsEnabled` off; `mixedContentMode`
`MIXED_CONTENT_NEVER_ALLOW`; and, with WebView 146 and newer, `backForwardCacheEnabled` on.

#### Default

```ts
{ userAgentString: null }
```

***

### webView?

> `optional` **webView?**: [`SettingsRoot`](SettingsRoot.md)\<[`AndroidSettingKeys`](AndroidSettingKeys.md)\[`"webView"`\]\>

`WebView` setters (static and inherited `View` ones too), then `WebViewCompat` ones, then `CookieManager`'s
`acceptThirdPartyCookies`. `webContentsDebuggingEnabled` is process-wide.

#### Default

```ts
{ webContentsDebuggingEnabled: __DEV__ }
```
