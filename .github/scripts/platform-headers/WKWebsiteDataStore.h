// Extract of /System/Library/Frameworks/WebKit.framework/Headers/WKWebsiteDataStore.h, iphonesimulator SDK 27.1
#if __has_include(<Network/proxy_config.h>)
#endif
@interface WKWebsiteDataStore : NSObject <NSSecureCoding>
@property (nonatomic, readonly, getter=isPersistent) BOOL persistent;
- (void)fetchDataRecordsOfTypes:(NSSet<NSString *> *)dataTypes completionHandler:(WK_SWIFT_UI_ACTOR void (^)(NSArray<WKWebsiteDataRecord *> *))completionHandler WK_SWIFT_ASYNC_NAME(dataRecords(ofTypes:));
- (void)removeDataOfTypes:(NSSet<NSString *> *)dataTypes forDataRecords:(NSArray<WKWebsiteDataRecord *> *)dataRecords completionHandler:(WK_SWIFT_UI_ACTOR void (^)(void))completionHandler;
- (void)removeDataOfTypes:(NSSet<NSString *> *)dataTypes modifiedSince:(NSDate *)date completionHandler:(WK_SWIFT_UI_ACTOR void (^)(void))completionHandler;
@property (nonatomic, readonly) WKHTTPCookieStore *httpCookieStore API_AVAILABLE(macos(10.13), ios(11.0));
@property (nonatomic, readonly, nullable) NSUUID *identifier API_AVAILABLE(macos(14.0), ios(17.0));
- (void)fetchDataOfTypes:(NSSet<NSString *> *)dataTypes completionHandler:(WK_SWIFT_UI_ACTOR void(^)(NSData * _Nullable data, NSError * _Nullable error))completionHandler NS_SWIFT_NAME(fetchData(of:completionHandler:)) API_AVAILABLE(macos(26.0), ios(26.0), visionos(26.0));
- (void)restoreData:(NSData *)data completionHandler:(WK_SWIFT_UI_ACTOR void(^)(NSError * _Nullable error))completionHandler NS_SWIFT_NAME(restoreData(_:completionHandler:)) API_AVAILABLE(macos(26.0), ios(26.0), visionos(26.0));
#if defined(OS_OBJECT_USE_OBJC) && OS_OBJECT_USE_OBJC
@property (nullable, nonatomic, copy) NSArray<nw_proxy_config_t> *proxyConfigurations NS_REFINED_FOR_SWIFT API_AVAILABLE(macos(14.0), ios(17.0));
#else
@property (nullable, nonatomic, copy) NSArray *proxyConfigurations NS_REFINED_FOR_SWIFT API_AVAILABLE(macos(14.0), ios(17.0));
#endif
@end
