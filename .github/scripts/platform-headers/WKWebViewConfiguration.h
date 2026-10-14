// Extract of /System/Library/Frameworks/WebKit.framework/Headers/WKWebViewConfiguration.h
#if TARGET_OS_IPHONE
#else
#endif
#if TARGET_OS_IPHONE
typedef NS_ENUM(NSInteger, WKSelectionGranularity) {
    WKSelectionGranularityDynamic,
    WKSelectionGranularityCharacter,
} API_DEPRECATED("This property is ignored; selection granularity is always `character`.", ios(8.0, 11.0), visionos(1.0, 1.0));
#else
typedef NS_ENUM(NSInteger, WKUserInterfaceDirectionPolicy) {
    WKUserInterfaceDirectionPolicyContent,
    WKUserInterfaceDirectionPolicySystem,
} API_AVAILABLE(macos(10.12));
#endif
typedef NS_OPTIONS(NSUInteger, WKAudiovisualMediaTypes) {
    WKAudiovisualMediaTypeNone = 0,
    WKAudiovisualMediaTypeAudio = 1 << 0,
    WKAudiovisualMediaTypeVideo = 1 << 1,
    WKAudiovisualMediaTypeAll = NSUIntegerMax
} API_AVAILABLE(macos(10.12), ios(10.0));
@interface WKWebViewConfiguration : NSObject <NSSecureCoding, NSCopying>
@property (nonatomic, strong) WKProcessPool *processPool API_DEPRECATED("Creating and using multiple instances of WKProcessPool no longer has any effect.", macos(10.10, 12.0), ios(8.0, 15.0), visionos(1.0, 1.0));
@property (nonatomic, strong) WKPreferences *preferences;
@property (nonatomic, strong) WKUserContentController *userContentController;
@property (nullable, nonatomic, strong) WKWebExtensionController *webExtensionController API_AVAILABLE(macos(15.4), ios(18.4), visionos(2.4));
@property (nonatomic, strong) WKWebsiteDataStore *websiteDataStore API_AVAILABLE(macos(10.11), ios(9.0));
@property (nonatomic) BOOL suppressesIncrementalRendering;
@property (nullable, nonatomic, copy) NSString *applicationNameForUserAgent API_AVAILABLE(macos(10.11), ios(9.0));
@property (nonatomic) BOOL allowsAirPlayForMediaPlayback API_AVAILABLE(macos(10.11), ios(9.0));
@property (nonatomic) BOOL showsSystemScreenTimeBlockingView API_AVAILABLE(macos(26.0), ios(26.0));
@property (nonatomic) BOOL upgradeKnownHostsToHTTPS API_AVAILABLE(macos(11.3), ios(14.5));
@property (nonatomic) WKAudiovisualMediaTypes mediaTypesRequiringUserActionForPlayback API_AVAILABLE(macos(10.12), ios(10.0));
@property (null_resettable, nonatomic, copy) WKWebpagePreferences *defaultWebpagePreferences API_AVAILABLE(macos(10.15), ios(13.0));
@property (nonatomic) BOOL limitsNavigationsToAppBoundDomains API_AVAILABLE(macos(11.0), ios(14.0));
@property (nonatomic) BOOL allowsInlinePredictions API_AVAILABLE(macos(14.0), ios(17.0));
#if TARGET_OS_IPHONE
@property (nonatomic) BOOL allowsInlineMediaPlayback;
@property (nonatomic) WKSelectionGranularity selectionGranularity API_DEPRECATED("This property is ignored; selection granularity is always `character`.", ios(8.0, 11.0), visionos(1.0, 1.0));
@property (nonatomic) BOOL allowsPictureInPictureMediaPlayback API_AVAILABLE(ios(9.0));
@property (nonatomic) WKDataDetectorTypes dataDetectorTypes API_AVAILABLE(ios(10.0));
@property (nonatomic) BOOL ignoresViewportScaleLimits API_AVAILABLE(ios(10.0));
#else
@property (nonatomic) WKUserInterfaceDirectionPolicy userInterfaceDirectionPolicy API_AVAILABLE(macos(10.12));
#endif
@property (nonatomic) BOOL supportsAdaptiveImageGlyph API_AVAILABLE(macos(15.0), ios(18.0), visionos(2.0));
#if TARGET_OS_IOS || (defined(TARGET_OS_VISION) && TARGET_OS_VISION && __VISION_OS_VERSION_MIN_REQUIRED >= 20400)
@property (nonatomic) UIWritingToolsBehavior writingToolsBehavior API_AVAILABLE(ios(18.0), visionos(2.4));
#elif TARGET_OS_OSX && __MAC_OS_X_VERSION_MIN_REQUIRED >= 150000
@property (nonatomic) NSWritingToolsBehavior writingToolsBehavior API_AVAILABLE(macos(15.0));
#endif
#if defined(TARGET_OS_VISION) && TARGET_OS_VISION
@property (nonatomic) BOOL allowsImmersiveEnvironments API_AVAILABLE(visionos(27.0));
#endif
@end
#if TARGET_OS_IPHONE
@interface WKWebViewConfiguration (WKDeprecated)
@property (nonatomic) BOOL mediaPlaybackRequiresUserAction API_DEPRECATED_WITH_REPLACEMENT("mediaTypesRequiringUserActionForPlayback", ios(8.0, 9.0));
@property (nonatomic) BOOL mediaPlaybackAllowsAirPlay API_DEPRECATED_WITH_REPLACEMENT("allowsAirPlayForMediaPlayback", ios(8.0, 9.0));
@property (nonatomic) BOOL requiresUserActionForMediaPlayback API_DEPRECATED_WITH_REPLACEMENT("mediaTypesRequiringUserActionForPlayback", ios(9.0, 10.0));
@end
#endif
