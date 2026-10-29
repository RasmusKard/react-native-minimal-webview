// Extract of /System/Library/Frameworks/WebKit.framework/Headers/WKHTTPCookieStore.h, iphonesimulator SDK 27.1
typedef NS_ENUM(NSInteger, WKCookiePolicy) {
    WKCookiePolicyAllow,
    WKCookiePolicyDisallow,
} NS_SWIFT_NAME(WKHTTPCookieStore.CookiePolicy) API_AVAILABLE(macos(14.0), ios(17.0));
@end
@interface WKHTTPCookieStore : NSObject
- (void)getAllCookies:(WK_SWIFT_UI_ACTOR void (^)(NSArray<NSHTTPCookie *> *))completionHandler;
- (void)getCookiesForURL:(NSURL *)url completionHandler:(NS_SWIFT_UI_ACTOR void (^)(NSArray<NSHTTPCookie *> *))completionHandler NS_SWIFT_NAME(getCookies(for:completionHandler:)) WK_SWIFT_ASYNC_NAME(cookies(for:)) API_AVAILABLE(macos(27.0), ios(27.0), visionos(27.0));
- (void)setCookie:(NSHTTPCookie *)cookie completionHandler:(nullable WK_SWIFT_UI_ACTOR void (^)(void))completionHandler;
- (void)setCookies:(NSArray<NSHTTPCookie *> *)cookies completionHandler:(nullable WK_SWIFT_UI_ACTOR void (^)(void))completionHandler API_AVAILABLE(macos(26.0), ios(26.0), visionos(26.0));
- (void)deleteCookie:(NSHTTPCookie *)cookie completionHandler:(nullable WK_SWIFT_UI_ACTOR void (^)(void))completionHandler WK_SWIFT_ASYNC_NAME(deleteCookie(_:));
- (void)setCookiePolicy:(WKCookiePolicy)policy completionHandler:(nullable WK_SWIFT_UI_ACTOR void (^)(void))completionHandler API_AVAILABLE(macos(14.0), ios(17.0));
- (void)getCookiePolicy:(WK_SWIFT_UI_ACTOR void (^)(WKCookiePolicy))completionHandler WK_SWIFT_ASYNC_NAME(getter:cookiePolicy()) API_AVAILABLE(macos(14.0), ios(17.0));
@end
