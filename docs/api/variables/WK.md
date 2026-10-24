# Variable: WK

> `const` **WK**: `object`

WebKit's and UIScrollView's enums and option sets by raw value, for the iOS keys that take one:
`configuration: { dataDetectorTypes: WK.DataDetectorTypes.link }`. An option set's `all` is the OR of its listed
bits, not `NSUIntegerMax`, which JSON can't carry. `WebsiteDataType` has the data type names the `websiteDataStore`
methods take, for `call`; `WebViewDataType` is the option set `webView.fetchDataOfTypes:` takes.

## Type Declaration

### AudiovisualMediaTypes

> `readonly` **AudiovisualMediaTypes**: `object`

#### AudiovisualMediaTypes.all

> `readonly` **all**: `3` = `3`

#### AudiovisualMediaTypes.audio

> `readonly` **audio**: `1` = `1`

#### AudiovisualMediaTypes.none

> `readonly` **none**: `0` = `0`

#### AudiovisualMediaTypes.video

> `readonly` **video**: `2` = `2`

### ContentInsetAdjustmentBehavior

> `readonly` **ContentInsetAdjustmentBehavior**: `object`

#### ContentInsetAdjustmentBehavior.always

> `readonly` **always**: `3` = `3`

#### ContentInsetAdjustmentBehavior.automatic

> `readonly` **automatic**: `0` = `0`

#### ContentInsetAdjustmentBehavior.never

> `readonly` **never**: `2` = `2`

#### ContentInsetAdjustmentBehavior.scrollableAxes

> `readonly` **scrollableAxes**: `1` = `1`

### ContentMode

> `readonly` **ContentMode**: `object`

#### ContentMode.desktop

> `readonly` **desktop**: `2` = `2`

#### ContentMode.mobile

> `readonly` **mobile**: `1` = `1`

#### ContentMode.recommended

> `readonly` **recommended**: `0` = `0`

### DataDetectorTypes

> `readonly` **DataDetectorTypes**: `object`

#### DataDetectorTypes.address

> `readonly` **address**: `4` = `4`

#### DataDetectorTypes.all

> `readonly` **all**: `127` = `127`

#### DataDetectorTypes.calendarEvent

> `readonly` **calendarEvent**: `8` = `8`

#### DataDetectorTypes.flightNumber

> `readonly` **flightNumber**: `32` = `32`

#### DataDetectorTypes.link

> `readonly` **link**: `2` = `2`

#### DataDetectorTypes.lookupSuggestion

> `readonly` **lookupSuggestion**: `64` = `64`

#### DataDetectorTypes.none

> `readonly` **none**: `0` = `0`

#### DataDetectorTypes.phoneNumber

> `readonly` **phoneNumber**: `1` = `1`

#### DataDetectorTypes.trackingNumber

> `readonly` **trackingNumber**: `16` = `16`

### FullscreenState

> `readonly` **FullscreenState**: `object`

#### FullscreenState.enteringFullscreen

> `readonly` **enteringFullscreen**: `1` = `1`

#### FullscreenState.exitingFullscreen

> `readonly` **exitingFullscreen**: `3` = `3`

#### FullscreenState.inFullscreen

> `readonly` **inFullscreen**: `2` = `2`

#### FullscreenState.notInFullscreen

> `readonly` **notInFullscreen**: `0` = `0`

### InactiveSchedulingPolicy

> `readonly` **InactiveSchedulingPolicy**: `object`

#### InactiveSchedulingPolicy.none

> `readonly` **none**: `2` = `2`

#### InactiveSchedulingPolicy.suspend

> `readonly` **suspend**: `0` = `0`

#### InactiveSchedulingPolicy.throttle

> `readonly` **throttle**: `1` = `1`

### IndicatorStyle

> `readonly` **IndicatorStyle**: `object`

#### IndicatorStyle.black

> `readonly` **black**: `1` = `1`

#### IndicatorStyle.default

> `readonly` **default**: `0` = `0`

#### IndicatorStyle.white

> `readonly` **white**: `2` = `2`

### KeyboardDismissMode

> `readonly` **KeyboardDismissMode**: `object`

#### KeyboardDismissMode.interactive

> `readonly` **interactive**: `2` = `2`

#### KeyboardDismissMode.interactiveWithAccessory

> `readonly` **interactiveWithAccessory**: `4` = `4`

#### KeyboardDismissMode.none

> `readonly` **none**: `0` = `0`

#### KeyboardDismissMode.onDrag

> `readonly` **onDrag**: `1` = `1`

#### KeyboardDismissMode.onDragWithAccessory

> `readonly` **onDragWithAccessory**: `3` = `3`

### MediaCaptureState

> `readonly` **MediaCaptureState**: `object`

#### MediaCaptureState.active

> `readonly` **active**: `1` = `1`

#### MediaCaptureState.muted

> `readonly` **muted**: `2` = `2`

#### MediaCaptureState.none

> `readonly` **none**: `0` = `0`

### MediaPlaybackState

> `readonly` **MediaPlaybackState**: `object`

#### MediaPlaybackState.none

> `readonly` **none**: `0` = `0`

#### MediaPlaybackState.paused

> `readonly` **paused**: `2` = `2`

#### MediaPlaybackState.playing

> `readonly` **playing**: `1` = `1`

#### MediaPlaybackState.suspended

> `readonly` **suspended**: `3` = `3`

### SecurityRestrictionMode

> `readonly` **SecurityRestrictionMode**: `object`

#### SecurityRestrictionMode.lockdown

> `readonly` **lockdown**: `2` = `2`

#### SecurityRestrictionMode.maximizeCompatibility

> `readonly` **maximizeCompatibility**: `1` = `1`

#### SecurityRestrictionMode.none

> `readonly` **none**: `0` = `0`

### SelectionGranularity

> `readonly` **SelectionGranularity**: `object`

#### SelectionGranularity.character

> `readonly` **character**: `1` = `1`

#### SelectionGranularity.dynamic

> `readonly` **dynamic**: `0` = `0`

### WebpagePreferencesUpgradeToHTTPSPolicy

> `readonly` **WebpagePreferencesUpgradeToHTTPSPolicy**: `object`

#### WebpagePreferencesUpgradeToHTTPSPolicy.automaticFallbackToHTTP

> `readonly` **automaticFallbackToHTTP**: `1` = `1`

#### WebpagePreferencesUpgradeToHTTPSPolicy.errorOnFailure

> `readonly` **errorOnFailure**: `3` = `3`

#### WebpagePreferencesUpgradeToHTTPSPolicy.keepAsRequested

> `readonly` **keepAsRequested**: `0` = `0`

#### WebpagePreferencesUpgradeToHTTPSPolicy.userMediatedFallbackToHTTP

> `readonly` **userMediatedFallbackToHTTP**: `2` = `2`

### WebsiteDataType

> `readonly` **WebsiteDataType**: `object`

`WKWebsiteDataStore` data types: `removeDataOfTypes:`, `fetchDataRecordsOfTypes:`

#### WebsiteDataType.cookies

> `readonly` **cookies**: `"WKWebsiteDataTypeCookies"` = `'WKWebsiteDataTypeCookies'`

#### WebsiteDataType.diskCache

> `readonly` **diskCache**: `"WKWebsiteDataTypeDiskCache"` = `'WKWebsiteDataTypeDiskCache'`

#### WebsiteDataType.fetchCache

> `readonly` **fetchCache**: `"WKWebsiteDataTypeFetchCache"` = `'WKWebsiteDataTypeFetchCache'`

#### WebsiteDataType.fileSystem

> `readonly` **fileSystem**: `"WKWebsiteDataTypeFileSystem"` = `'WKWebsiteDataTypeFileSystem'`

#### WebsiteDataType.hashSalt

> `readonly` **hashSalt**: `"WKWebsiteDataTypeHashSalt"` = `'WKWebsiteDataTypeHashSalt'`

#### WebsiteDataType.indexedDBDatabases

> `readonly` **indexedDBDatabases**: `"WKWebsiteDataTypeIndexedDBDatabases"` = `'WKWebsiteDataTypeIndexedDBDatabases'`

#### WebsiteDataType.localStorage

> `readonly` **localStorage**: `"WKWebsiteDataTypeLocalStorage"` = `'WKWebsiteDataTypeLocalStorage'`

#### WebsiteDataType.mediaKeys

> `readonly` **mediaKeys**: `"WKWebsiteDataTypeMediaKeys"` = `'WKWebsiteDataTypeMediaKeys'`

#### WebsiteDataType.memoryCache

> `readonly` **memoryCache**: `"WKWebsiteDataTypeMemoryCache"` = `'WKWebsiteDataTypeMemoryCache'`

#### WebsiteDataType.screenTime

> `readonly` **screenTime**: `"WKWebsiteDataTypeScreenTime"` = `'WKWebsiteDataTypeScreenTime'`

#### WebsiteDataType.searchFieldRecentSearches

> `readonly` **searchFieldRecentSearches**: `"WKWebsiteDataTypeSearchFieldRecentSearches"` = `'WKWebsiteDataTypeSearchFieldRecentSearches'`

#### WebsiteDataType.serviceWorkerRegistrations

> `readonly` **serviceWorkerRegistrations**: `"WKWebsiteDataTypeServiceWorkerRegistrations"` = `'WKWebsiteDataTypeServiceWorkerRegistrations'`

#### WebsiteDataType.sessionStorage

> `readonly` **sessionStorage**: `"WKWebsiteDataTypeSessionStorage"` = `'WKWebsiteDataTypeSessionStorage'`

#### WebsiteDataType.webSQLDatabases

> `readonly` **webSQLDatabases**: `"WKWebsiteDataTypeWebSQLDatabases"` = `'WKWebsiteDataTypeWebSQLDatabases'`

### WebViewDataType

> `readonly` **WebViewDataType**: `object`

#### WebViewDataType.sessionStorage

> `readonly` **sessionStorage**: `1` = `1`
