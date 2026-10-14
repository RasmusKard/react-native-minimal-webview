// Extract of /System/Library/Frameworks/WebKit.framework/Headers/WKPreferences.h
@interface WKPreferences : NSObject <NSSecureCoding>
@property (nonatomic) CGFloat minimumFontSize;
@property (nonatomic) BOOL javaScriptCanOpenWindowsAutomatically;
@property (nonatomic, getter=isFraudulentWebsiteWarningEnabled) BOOL fraudulentWebsiteWarningEnabled API_AVAILABLE(macos(10.15), ios(13.0));
@property (nonatomic) BOOL shouldPrintBackgrounds API_AVAILABLE(macos(13.3), ios(16.4));
#if !TARGET_OS_IPHONE
@property (nonatomic) BOOL tabFocusesLinks API_AVAILABLE(macos(10.12.4));
#endif
@property (nonatomic, getter=isTextInteractionEnabled) BOOL textInteractionEnabled API_AVAILABLE(macos(11.3), ios(14.5));
@property (nonatomic, getter=isSiteSpecificQuirksModeEnabled) BOOL siteSpecificQuirksModeEnabled API_AVAILABLE(macos(12.3), ios(15.4));
@property (nonatomic, getter=isElementFullscreenEnabled) BOOL elementFullscreenEnabled API_AVAILABLE(macos(12.3), ios(15.4), tvos(17.0));
typedef NS_ENUM(NSInteger, WKInactiveSchedulingPolicy) {
    WKInactiveSchedulingPolicySuspend,
    WKInactiveSchedulingPolicyThrottle,
    WKInactiveSchedulingPolicyNone
} NS_SWIFT_NAME(WKPreferences.InactiveSchedulingPolicy) API_AVAILABLE(macos(14.0), ios(17.0));
@property (nonatomic) WKInactiveSchedulingPolicy inactiveSchedulingPolicy API_AVAILABLE(macos(14.0), ios(17.0));
@property (nonatomic) BOOL isLookToScrollEnabled API_AVAILABLE(visionos(26.0)) API_UNAVAILABLE(macos, ios, macCatalyst, tvos, watchos);
@end
@interface WKPreferences (WKDeprecated)
#if !TARGET_OS_IPHONE
@property (nonatomic) BOOL javaEnabled API_DEPRECATED("Java is no longer supported", macos(10.10, 10.15));
@property (nonatomic) BOOL plugInsEnabled API_DEPRECATED("Plug-ins are no longer supported", macos(10.10, 10.15));
#endif
@property (nonatomic) BOOL javaScriptEnabled API_DEPRECATED("Use WKWebpagePreferences.allowsContentJavaScript to disable content JavaScript on a per-navigation basis", macos(10.10, 11.0), ios(8.0, 14.0));
@end
