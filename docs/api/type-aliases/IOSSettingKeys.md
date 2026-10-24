# Type Alias: IOSSettingKeys

> **IOSSettingKeys** = `object`

The iOS settings keys by root: the writable WebKit and UIScrollView properties the settings channel can carry, from
the SDK headers. `@since` is the iOS version. A key a newer SDK adds works too: `IOSSettings` takes any key.

## Properties

### configuration

> **configuration**: `object`

`WKWebViewConfiguration`

#### allowsAirPlayForMediaPlayback?

> `optional` **allowsAirPlayForMediaPlayback?**: `boolean`

##### Since

9.0

#### allowsInlineMediaPlayback?

> `optional` **allowsInlineMediaPlayback?**: `boolean`

#### allowsInlinePredictions?

> `optional` **allowsInlinePredictions?**: `boolean`

##### Since

17.0

#### allowsPictureInPictureMediaPlayback?

> `optional` **allowsPictureInPictureMediaPlayback?**: `boolean`

##### Since

9.0

#### applicationNameForUserAgent?

> `optional` **applicationNameForUserAgent?**: `string` \| `null`

##### Since

9.0

#### dataDetectorTypes?

> `optional` **dataDetectorTypes?**: `number`

##### Since

10.0

#### ignoresViewportScaleLimits?

> `optional` **ignoresViewportScaleLimits?**: `boolean`

##### Since

10.0

#### limitsNavigationsToAppBoundDomains?

> `optional` **limitsNavigationsToAppBoundDomains?**: `boolean`

##### Since

14.0

#### ~~mediaPlaybackAllowsAirPlay?~~

> `optional` **mediaPlaybackAllowsAirPlay?**: `boolean`

##### Since

8.0

##### Deprecated

use allowsAirPlayForMediaPlayback

#### ~~mediaPlaybackRequiresUserAction?~~

> `optional` **mediaPlaybackRequiresUserAction?**: `boolean`

##### Since

8.0

##### Deprecated

use mediaTypesRequiringUserActionForPlayback

#### mediaTypesRequiringUserActionForPlayback?

> `optional` **mediaTypesRequiringUserActionForPlayback?**: `number`

##### Since

10.0

#### ~~requiresUserActionForMediaPlayback?~~

> `optional` **requiresUserActionForMediaPlayback?**: `boolean`

##### Since

9.0

##### Deprecated

use mediaTypesRequiringUserActionForPlayback

#### selectionGranularity?

> `optional` **selectionGranularity?**: `number`

#### showsSystemScreenTimeBlockingView?

> `optional` **showsSystemScreenTimeBlockingView?**: `boolean`

##### Since

26.0

#### supportsAdaptiveImageGlyph?

> `optional` **supportsAdaptiveImageGlyph?**: `boolean`

##### Since

18.0

#### suppressesIncrementalRendering?

> `optional` **suppressesIncrementalRendering?**: `boolean`

#### upgradeKnownHostsToHTTPS?

> `optional` **upgradeKnownHostsToHTTPS?**: `boolean`

##### Since

14.5

#### websiteDataStore?

> `optional` **websiteDataStore?**: `"default"` \| `"nonPersistent"`

##### Since

9.0

#### writingToolsBehavior?

> `optional` **writingToolsBehavior?**: `number`

##### Since

18.0

***

### preferences

> **preferences**: `object`

`WKPreferences`

#### elementFullscreenEnabled?

> `optional` **elementFullscreenEnabled?**: `boolean`

##### Since

15.4

#### fraudulentWebsiteWarningEnabled?

> `optional` **fraudulentWebsiteWarningEnabled?**: `boolean`

##### Since

13.0

#### inactiveSchedulingPolicy?

> `optional` **inactiveSchedulingPolicy?**: `number`

##### Since

17.0

#### javaScriptCanOpenWindowsAutomatically?

> `optional` **javaScriptCanOpenWindowsAutomatically?**: `boolean`

#### ~~javaScriptEnabled?~~

> `optional` **javaScriptEnabled?**: `boolean`

##### Since

8.0

##### Deprecated

Use WKWebpagePreferences.allowsContentJavaScript to disable content JavaScript on a per-navigation basis

#### minimumFontSize?

> `optional` **minimumFontSize?**: `number`

#### shouldPrintBackgrounds?

> `optional` **shouldPrintBackgrounds?**: `boolean`

##### Since

16.4

#### siteSpecificQuirksModeEnabled?

> `optional` **siteSpecificQuirksModeEnabled?**: `boolean`

##### Since

15.4

#### textInteractionEnabled?

> `optional` **textInteractionEnabled?**: `boolean`

##### Since

14.5

***

### scrollView

> **scrollView**: `object`

`UIScrollView`

#### allowsKeyboardScrolling?

> `optional` **allowsKeyboardScrolling?**: `boolean`

##### Since

17.0

#### alwaysBounceHorizontal?

> `optional` **alwaysBounceHorizontal?**: `boolean`

#### alwaysBounceVertical?

> `optional` **alwaysBounceVertical?**: `boolean`

#### automaticallyAdjustsScrollIndicatorInsets?

> `optional` **automaticallyAdjustsScrollIndicatorInsets?**: `boolean`

##### Since

13.0

#### bounces?

> `optional` **bounces?**: `boolean`

#### bouncesHorizontally?

> `optional` **bouncesHorizontally?**: `boolean`

##### Since

17.4

#### bouncesVertically?

> `optional` **bouncesVertically?**: `boolean`

##### Since

17.4

#### bouncesZoom?

> `optional` **bouncesZoom?**: `boolean`

#### canCancelContentTouches?

> `optional` **canCancelContentTouches?**: `boolean`

#### contentAlignmentPoint?

> `optional` **contentAlignmentPoint?**: [`CGPoint`](CGPoint.md)

##### Since

17.4

#### contentInset?

> `optional` **contentInset?**: [`UIEdgeInsets`](UIEdgeInsets.md)

#### contentInsetAdjustmentBehavior?

> `optional` **contentInsetAdjustmentBehavior?**: `number`

##### Since

11.0

#### contentOffset?

> `optional` **contentOffset?**: [`CGPoint`](CGPoint.md)

#### contentSize?

> `optional` **contentSize?**: [`CGSize`](CGSize.md)

#### decelerationRate?

> `optional` **decelerationRate?**: `number`

##### Since

3.0

#### delaysContentTouches?

> `optional` **delaysContentTouches?**: `boolean`

#### directionalLockEnabled?

> `optional` **directionalLockEnabled?**: `boolean`

#### horizontalScrollIndicatorInsets?

> `optional` **horizontalScrollIndicatorInsets?**: [`UIEdgeInsets`](UIEdgeInsets.md)

##### Since

11.1

#### indicatorStyle?

> `optional` **indicatorStyle?**: `number`

#### keyboardDismissMode?

> `optional` **keyboardDismissMode?**: `number`

##### Since

7.0

#### maximumZoomScale?

> `optional` **maximumZoomScale?**: `number`

#### minimumZoomScale?

> `optional` **minimumZoomScale?**: `number`

#### pagingEnabled?

> `optional` **pagingEnabled?**: `boolean`

#### scrollEnabled?

> `optional` **scrollEnabled?**: `boolean`

#### scrollIndicatorInsets?

> `optional` **scrollIndicatorInsets?**: [`UIEdgeInsets`](UIEdgeInsets.md)

#### scrollsToTop?

> `optional` **scrollsToTop?**: `boolean`

#### showsHorizontalScrollIndicator?

> `optional` **showsHorizontalScrollIndicator?**: `boolean`

#### showsVerticalScrollIndicator?

> `optional` **showsVerticalScrollIndicator?**: `boolean`

#### transfersHorizontalScrollingToParent?

> `optional` **transfersHorizontalScrollingToParent?**: `boolean`

##### Since

17.4

#### transfersVerticalScrollingToParent?

> `optional` **transfersVerticalScrollingToParent?**: `boolean`

##### Since

17.4

#### verticalScrollIndicatorInsets?

> `optional` **verticalScrollIndicatorInsets?**: [`UIEdgeInsets`](UIEdgeInsets.md)

##### Since

11.1

#### zoomScale?

> `optional` **zoomScale?**: `number`

##### Since

3.0

***

### webpagePreferences

> **webpagePreferences**: `object`

`WKWebpagePreferences`

#### allowsContentJavaScript?

> `optional` **allowsContentJavaScript?**: `boolean`

##### Since

14.0

#### allowsJSHandleCreationInPageWorld?

> `optional` **allowsJSHandleCreationInPageWorld?**: `boolean`

##### Since

27.0

#### globalPrivacyControlEnabled?

> `optional` **globalPrivacyControlEnabled?**: `boolean`

##### Since

27.0

#### lockdownModeEnabled?

> `optional` **lockdownModeEnabled?**: `boolean`

##### Since

16.0

#### overrideReferrer?

> `optional` **overrideReferrer?**: `string` \| `null`

##### Since

27.0

#### preferredContentMode?

> `optional` **preferredContentMode?**: `number`

##### Since

13.0

#### preferredHTTPSNavigationPolicy?

> `optional` **preferredHTTPSNavigationPolicy?**: `number`

##### Since

18.2

#### securityRestrictionMode?

> `optional` **securityRestrictionMode?**: `number`

##### Since

26.4

***

### webView

> **webView**: `object`

`WKWebView`

#### allowsBackForwardNavigationGestures?

> `optional` **allowsBackForwardNavigationGestures?**: `boolean`

#### allowsLinkPreview?

> `optional` **allowsLinkPreview?**: `boolean`

##### Since

9.0

#### customUserAgent?

> `optional` **customUserAgent?**: `string` \| `null`

##### Since

9.0

#### findInteractionEnabled?

> `optional` **findInteractionEnabled?**: `boolean`

##### Since

16.0

#### inspectable?

> `optional` **inspectable?**: `boolean`

##### Since

16.4

#### mediaType?

> `optional` **mediaType?**: `string` \| `null`

##### Since

14.0

#### obscuredContentInsets?

> `optional` **obscuredContentInsets?**: [`UIEdgeInsets`](UIEdgeInsets.md)

##### Since

26.0

#### pageZoom?

> `optional` **pageZoom?**: `number`

##### Since

14.0

#### underPageBackgroundColor?

> `optional` **underPageBackgroundColor?**: `string` \| `null`

##### Since

15.0
