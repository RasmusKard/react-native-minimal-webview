// Extract of /System/Library/Frameworks/WebKit.framework/Headers/WKWebsiteDataRecord.h
WK_EXTERN NSString * const WKWebsiteDataTypeFetchCache API_AVAILABLE(macos(10.13.4), ios(11.3));
WK_EXTERN NSString * const WKWebsiteDataTypeDiskCache API_AVAILABLE(macos(10.11), ios(9.0));
WK_EXTERN NSString * const WKWebsiteDataTypeMemoryCache API_AVAILABLE(macos(10.11), ios(9.0));
WK_EXTERN NSString * const WKWebsiteDataTypeOfflineWebApplicationCache API_DEPRECATED("WebApplicationCache is no longer supported", macos(10.11, 26.2), ios(9.0, 26.2));
WK_EXTERN NSString * const WKWebsiteDataTypeCookies API_AVAILABLE(macos(10.11), ios(9.0));
WK_EXTERN NSString * const WKWebsiteDataTypeSessionStorage API_AVAILABLE(macos(10.11), ios(9.0));
WK_EXTERN NSString * const WKWebsiteDataTypeLocalStorage API_AVAILABLE(macos(10.11), ios(9.0));
WK_EXTERN NSString * const WKWebsiteDataTypeWebSQLDatabases API_AVAILABLE(macos(10.11), ios(9.0));
WK_EXTERN NSString * const WKWebsiteDataTypeIndexedDBDatabases API_AVAILABLE(macos(10.11), ios(9.0));
WK_EXTERN NSString * const WKWebsiteDataTypeServiceWorkerRegistrations API_AVAILABLE(macos(10.13.4), ios(11.3));
WK_EXTERN NSString * const WKWebsiteDataTypeFileSystem API_AVAILABLE(macos(13.0), ios(16.0));
WK_EXTERN NSString * const WKWebsiteDataTypeSearchFieldRecentSearches API_AVAILABLE(macos(14.0), ios(17.0));
WK_EXTERN NSString * const WKWebsiteDataTypeMediaKeys API_AVAILABLE(macos(14.0), ios(17.0));
WK_EXTERN NSString * const WKWebsiteDataTypeHashSalt API_AVAILABLE(macos(14.0), ios(17.0));
WK_EXTERN NSString * const WKWebsiteDataTypeScreenTime API_AVAILABLE(macos(26.0), ios(26.0)) API_UNAVAILABLE(visionos);
@interface WKWebsiteDataRecord : NSObject
@property (nonatomic, readonly, copy) NSString *displayName;
@property (nonatomic, readonly, copy) NSSet<NSString *> *dataTypes;
@end
