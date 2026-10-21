// Extract of /System/Library/Frameworks/WebKit.framework/Headers/WKWebpagePreferences.h, iphonesimulator SDK 27.1
typedef NS_ENUM(NSInteger, WKContentMode) {
    WKContentModeRecommended,
    WKContentModeMobile,
    WKContentModeDesktop
} API_AVAILABLE(ios(13.0));
typedef NS_ENUM(NSInteger, WKWebpagePreferencesUpgradeToHTTPSPolicy) {
    WKWebpagePreferencesUpgradeToHTTPSPolicyKeepAsRequested,
    WKWebpagePreferencesUpgradeToHTTPSPolicyAutomaticFallbackToHTTP,
    WKWebpagePreferencesUpgradeToHTTPSPolicyUserMediatedFallbackToHTTP,
    WKWebpagePreferencesUpgradeToHTTPSPolicyErrorOnFailure
} NS_SWIFT_NAME(WKWebpagePreferences.UpgradeToHTTPSPolicy) API_AVAILABLE(macos(15.2), ios(18.2), visionos(2.2));
typedef NS_ENUM(NSInteger, WKSecurityRestrictionMode) {
    WKSecurityRestrictionModeNone,
    WKSecurityRestrictionModeMaximizeCompatibility,
    WKSecurityRestrictionModeLockdown
} API_AVAILABLE(macos(26.4), ios(26.4), visionos(26.4));
@interface WKWebpagePreferences : NSObject
@property (nonatomic) WKContentMode preferredContentMode API_AVAILABLE(ios(13.0));
@property (nonatomic) BOOL allowsContentJavaScript API_AVAILABLE(macos(11.0), ios(14.0));
@property (nonatomic, getter=isLockdownModeEnabled) BOOL lockdownModeEnabled API_AVAILABLE(macos(13.0), ios(16.0));
@property (nonatomic) WKWebpagePreferencesUpgradeToHTTPSPolicy preferredHTTPSNavigationPolicy API_AVAILABLE(macos(15.2), ios(18.2), visionos(2.2));
@property (nonatomic) WKSecurityRestrictionMode securityRestrictionMode API_AVAILABLE(macos(26.4), ios(26.4), visionos(26.4));
@property (nonatomic, copy, nullable) NSURLRequest *alternateRequest API_AVAILABLE(macos(27.0), ios(27.0), visionos(27.0));
@property (nonatomic, copy, nullable) NSString *overrideReferrer API_AVAILABLE(macos(27.0), ios(27.0), visionos(27.0));
@property (nonatomic) BOOL allowsJSHandleCreationInPageWorld API_AVAILABLE(macos(27.0), ios(27.0), visionos(27.0));
@property (nonatomic) BOOL globalPrivacyControlEnabled API_AVAILABLE(macos(27.0), ios(27.0), visionos(27.0));
@end
