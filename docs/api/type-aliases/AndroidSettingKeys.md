# Type Alias: AndroidSettingKeys

> **AndroidSettingKeys** = `object`

The Android settings keys by root: the one-argument `WebSettings`, `WebView` and `CookieManager` setters, then
`WebSettingsCompat`'s and `WebViewCompat`'s statics, then the scroll setters `WebView` inherits from `View`.
`@since` is the API level. A key a newer SDK or androidx.webkit adds works too: `AndroidSettings` takes any key.

## Properties

### settings

> **settings**: `object`

`WebSettings`, then `WebSettingsCompat`

#### algorithmicDarkeningAllowed?

> `optional` **algorithmicDarkeningAllowed?**: `boolean`

##### Since

33

#### allowContentAccess?

> `optional` **allowContentAccess?**: `boolean`

##### Since

11

#### allowFileAccess?

> `optional` **allowFileAccess?**: `boolean`

##### Since

3

#### ~~allowFileAccessFromFileURLs?~~

> `optional` **allowFileAccessFromFileURLs?**: `boolean`

##### Since

16

##### Deprecated

since API 30

#### ~~allowUniversalAccessFromFileURLs?~~

> `optional` **allowUniversalAccessFromFileURLs?**: `boolean`

##### Since

16

##### Deprecated

since API 30

#### attributionRegistrationBehavior?

> `optional` **attributionRegistrationBehavior?**: `number`

`WebSettingsCompat`, WebView feature `ATTRIBUTION_REGISTRATION_BEHAVIOR`

#### backForwardCacheEnabled?

> `optional` **backForwardCacheEnabled?**: `boolean`

`WebSettingsCompat`, WebView feature `BACK_FORWARD_CACHE`

#### blockNetworkImage?

> `optional` **blockNetworkImage?**: `boolean`

##### Since

1

#### blockNetworkLoads?

> `optional` **blockNetworkLoads?**: `boolean`

##### Since

8

#### builtInZoomControls?

> `optional` **builtInZoomControls?**: `boolean`

##### Since

3

#### cacheMode?

> `optional` **cacheMode?**: `number`

##### Since

1

#### cookiesIncludedInShouldInterceptRequest?

> `optional` **cookiesIncludedInShouldInterceptRequest?**: `boolean`

`WebSettingsCompat`, WebView feature `COOKIE_INTERCEPT`

#### cursiveFontFamily?

> `optional` **cursiveFontFamily?**: `string`

##### Since

1

#### ~~databaseEnabled?~~

> `optional` **databaseEnabled?**: `boolean`

##### Since

5

##### Deprecated

since API 35

#### ~~databasePath?~~

> `optional` **databasePath?**: `string`

##### Since

5

##### Deprecated

since API 19

#### defaultFixedFontSize?

> `optional` **defaultFixedFontSize?**: `number`

##### Since

1

#### defaultFontSize?

> `optional` **defaultFontSize?**: `number`

##### Since

1

#### defaultTextEncodingName?

> `optional` **defaultTextEncodingName?**: `string`

##### Since

1

#### disabledActionModeMenuItems?

> `optional` **disabledActionModeMenuItems?**: `number`

##### Since

24

#### displayZoomControls?

> `optional` **displayZoomControls?**: `boolean`

##### Since

11

#### domStorageEnabled?

> `optional` **domStorageEnabled?**: `boolean`

##### Since

7

#### downloadFaviconsEnabled?

> `optional` **downloadFaviconsEnabled?**: `boolean`

`WebSettingsCompat`, WebView feature `DOWNLOAD_FAVICONS_ENABLED`

#### ~~enableSmoothTransition?~~

> `optional` **enableSmoothTransition?**: `boolean`

##### Since

11

##### Deprecated

since API 17

#### enterpriseAuthenticationAppLinkPolicyEnabled?

> `optional` **enterpriseAuthenticationAppLinkPolicyEnabled?**: `boolean`

`WebSettingsCompat`, WebView feature `ENTERPRISE_AUTHENTICATION_APP_LINK_POLICY`

#### fantasyFontFamily?

> `optional` **fantasyFontFamily?**: `string`

##### Since

1

#### fixedFontFamily?

> `optional` **fixedFontFamily?**: `string`

##### Since

1

#### ~~forceDark?~~

> `optional` **forceDark?**: `number`

##### Since

29

##### Deprecated

since API 33

#### ~~forceDarkStrategy?~~

> `optional` **forceDarkStrategy?**: `number`

`WebSettingsCompat`, WebView feature `FORCE_DARK_STRATEGY`

##### Deprecated

in androidx.webkit

#### ~~geolocationDatabasePath?~~

> `optional` **geolocationDatabasePath?**: `string`

##### Since

5

##### Deprecated

since API 24

#### geolocationEnabled?

> `optional` **geolocationEnabled?**: `boolean`

##### Since

5

#### hasEnrolledInstrumentEnabled?

> `optional` **hasEnrolledInstrumentEnabled?**: `boolean`

`WebSettingsCompat`, WebView feature `PAYMENT_REQUEST`

#### hyperlinkContextMenuItems?

> `optional` **hyperlinkContextMenuItems?**: `number`

`WebSettingsCompat`, WebView feature `HYPERLINK_CONTEXT_MENU_ITEMS`

#### javaScriptCanOpenWindowsAutomatically?

> `optional` **javaScriptCanOpenWindowsAutomatically?**: `boolean`

##### Since

1

#### javaScriptEnabled?

> `optional` **javaScriptEnabled?**: `boolean`

##### Since

1

#### ~~lightTouchEnabled?~~

> `optional` **lightTouchEnabled?**: `boolean`

##### Since

1

##### Deprecated

since API 18

#### loadsImagesAutomatically?

> `optional` **loadsImagesAutomatically?**: `boolean`

##### Since

1

#### loadWithOverviewMode?

> `optional` **loadWithOverviewMode?**: `boolean`

##### Since

7

#### mediaPlaybackRequiresUserGesture?

> `optional` **mediaPlaybackRequiresUserGesture?**: `boolean`

##### Since

17

#### minimumFontSize?

> `optional` **minimumFontSize?**: `number`

##### Since

1

#### minimumLogicalFontSize?

> `optional` **minimumLogicalFontSize?**: `number`

##### Since

1

#### mixedContentMode?

> `optional` **mixedContentMode?**: `number`

##### Since

21

#### needInitialFocus?

> `optional` **needInitialFocus?**: `boolean`

##### Since

1

#### offscreenPreRaster?

> `optional` **offscreenPreRaster?**: `boolean`

##### Since

23

#### paymentRequestEnabled?

> `optional` **paymentRequestEnabled?**: `boolean`

`WebSettingsCompat`, WebView feature `PAYMENT_REQUEST`

#### safeBrowsingEnabled?

> `optional` **safeBrowsingEnabled?**: `boolean`

##### Since

26

#### sansSerifFontFamily?

> `optional` **sansSerifFontFamily?**: `string`

##### Since

1

#### ~~saveFormData?~~

> `optional` **saveFormData?**: `boolean`

##### Since

1

##### Deprecated

since API 26

#### ~~savePassword?~~

> `optional` **savePassword?**: `boolean`

##### Since

1

##### Deprecated

since API 18

#### serifFontFamily?

> `optional` **serifFontFamily?**: `string`

##### Since

1

#### speculativeLoadingStatus?

> `optional` **speculativeLoadingStatus?**: `number`

`WebSettingsCompat`, WebView feature `SPECULATIVE_LOADING`

#### standardFontFamily?

> `optional` **standardFontFamily?**: `string`

##### Since

1

#### supportMultipleWindows?

> `optional` **supportMultipleWindows?**: `boolean`

##### Since

1

#### supportZoom?

> `optional` **supportZoom?**: `boolean`

##### Since

1

#### textZoom?

> `optional` **textZoom?**: `number`

##### Since

14

#### userAgentString?

> `optional` **userAgentString?**: `string`

##### Since

3

#### useWideViewPort?

> `optional` **useWideViewPort?**: `boolean`

##### Since

1

#### webAuthenticationSupport?

> `optional` **webAuthenticationSupport?**: `number`

`WebSettingsCompat`, WebView feature `WEB_AUTHENTICATION`

***

### webView

> **webView**: `object`

`WebView`, then `WebViewCompat`, then `CookieManager`, then `View`'s scroll setters

#### acceptThirdPartyCookies?

> `optional` **acceptThirdPartyCookies?**: `boolean`

`CookieManager`

##### Since

21

#### audioMuted?

> `optional` **audioMuted?**: `boolean`

`WebViewCompat`, WebView feature `MUTE_AUDIO`

#### dataDirectorySuffix?

> `optional` **dataDirectorySuffix?**: `string`

##### Since

28

#### horizontalScrollBarEnabled?

> `optional` **horizontalScrollBarEnabled?**: `boolean`

`View`

##### Since

1

#### ~~horizontalScrollbarOverlay?~~

> `optional` **horizontalScrollbarOverlay?**: `boolean`

##### Since

1

##### Deprecated

since API 23

#### initialScale?

> `optional` **initialScale?**: `number`

##### Since

1

#### ~~mapTrackballToArrowKeys?~~

> `optional` **mapTrackballToArrowKeys?**: `boolean`

##### Since

1

##### Deprecated

since API 17

#### nestedScrollingEnabled?

> `optional` **nestedScrollingEnabled?**: `boolean`

`View`

##### Since

21

#### networkAvailable?

> `optional` **networkAvailable?**: `boolean`

##### Since

3

#### overScrollMode?

> `optional` **overScrollMode?**: `number`

`View`

##### Since

9

#### profile?

> `optional` **profile?**: `string`

`WebViewCompat`, WebView feature `MULTI_PROFILE`

#### scrollBarDefaultDelayBeforeFade?

> `optional` **scrollBarDefaultDelayBeforeFade?**: `number`

`View`

##### Since

16

#### scrollBarFadeDuration?

> `optional` **scrollBarFadeDuration?**: `number`

`View`

##### Since

16

#### scrollbarFadingEnabled?

> `optional` **scrollbarFadingEnabled?**: `boolean`

`View`

##### Since

5

#### scrollBarSize?

> `optional` **scrollBarSize?**: `number`

`View`

##### Since

16

#### scrollBarStyle?

> `optional` **scrollBarStyle?**: `number`

`View`

##### Since

1

#### scrollCaptureHint?

> `optional` **scrollCaptureHint?**: `number`

`View`

##### Since

31

#### scrollContainer?

> `optional` **scrollContainer?**: `boolean`

`View`

##### Since

3

#### scrollIndicators?

> `optional` **scrollIndicators?**: `number`

`View`

##### Since

23

#### scrollX?

> `optional` **scrollX?**: `number`

`View`

##### Since

14

#### scrollY?

> `optional` **scrollY?**: `number`

`View`

##### Since

14

#### verticalScrollBarEnabled?

> `optional` **verticalScrollBarEnabled?**: `boolean`

`View`

##### Since

1

#### ~~verticalScrollbarOverlay?~~

> `optional` **verticalScrollbarOverlay?**: `boolean`

##### Since

1

##### Deprecated

since API 23

#### verticalScrollbarPosition?

> `optional` **verticalScrollbarPosition?**: `number`

`View`

##### Since

11

#### webContentsDebuggingEnabled?

> `optional` **webContentsDebuggingEnabled?**: `boolean`

##### Since

19
