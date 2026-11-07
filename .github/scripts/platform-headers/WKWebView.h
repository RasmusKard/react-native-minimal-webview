// Extract of /System/Library/Frameworks/WebKit.framework/Headers/WKWebView.h, iphonesimulator SDK 27.1
@interface WKWebView : UIView
typedef NS_ENUM(NSInteger, WKMediaPlaybackState) {
    WKMediaPlaybackStateNone,
    WKMediaPlaybackStatePlaying,
    WKMediaPlaybackStatePaused,
    WKMediaPlaybackStateSuspended
} API_AVAILABLE(macos(11.3), ios(14.5));
typedef NS_ENUM(NSInteger, WKMediaCaptureState) {
    WKMediaCaptureStateNone,
    WKMediaCaptureStateActive,
    WKMediaCaptureStateMuted,
} API_AVAILABLE(macos(12.0), ios(15.0));
typedef NS_ENUM(NSInteger, WKFullscreenState) {
    WKFullscreenStateNotInFullscreen,
    WKFullscreenStateEnteringFullscreen,
    WKFullscreenStateInFullscreen,
    WKFullscreenStateExitingFullscreen,
} NS_SWIFT_NAME(WKWebView.FullscreenState) API_AVAILABLE(macos(13.0), ios(16.0));
@property (nonatomic, readonly, copy) WKWebViewConfiguration *configuration;
@property (nullable, nonatomic, weak) id <WKNavigationDelegate> navigationDelegate;
@property (nullable, nonatomic, weak) id <WKUIDelegate> UIDelegate;
@property (nonatomic, readonly, strong) WKBackForwardList *backForwardList;
@property (nullable, nonatomic, readonly, copy) NSString *title;
@property (nullable, nonatomic, readonly, copy) NSURL *URL;
@property (nonatomic, readonly, getter=isLoading) BOOL loading;
@property (nonatomic, readonly) double estimatedProgress;
@property (nonatomic, readonly) BOOL hasOnlySecureContent;
@property (nonatomic, readonly, nullable) SecTrustRef serverTrust API_AVAILABLE(macos(10.12), ios(10.0));
@property (nonatomic, readonly) BOOL canGoBack;
@property (nonatomic, readonly) BOOL canGoForward;
- (void)evaluateJavaScript:(NSString *)javaScriptString completionHandler:(WK_SWIFT_UI_ACTOR void (^ _Nullable)(id WK_NULLABLE_RESULT, NSError * _Nullable error))completionHandler;
- (void)evaluateJavaScript:(NSString *)javaScriptString inFrame:(nullable WKFrameInfo *)frame inContentWorld:(WKContentWorld *)contentWorld completionHandler:(WK_SWIFT_UI_ACTOR void (^ _Nullable)(id WK_NULLABLE_RESULT, NSError * _Nullable error))completionHandler NS_REFINED_FOR_SWIFT API_AVAILABLE(macos(11.0), ios(14.0));
- (void)callAsyncJavaScript:(NSString *)functionBody arguments:(nullable NSDictionary<NSString *, id> *)arguments inFrame:(nullable WKFrameInfo *)frame inContentWorld:(WKContentWorld *)contentWorld completionHandler:(WK_SWIFT_UI_ACTOR void (^ _Nullable)(id WK_NULLABLE_RESULT result, NSError * _Nullable error))completionHandler NS_REFINED_FOR_SWIFT API_AVAILABLE(macos(11.0), ios(14.0));
- (void)closeAllMediaPresentationsWithCompletionHandler:(WK_SWIFT_UI_ACTOR void (^_Nullable)(void))completionHandler API_AVAILABLE(macos(12.0), ios(15.0));
- (void)pauseAllMediaPlaybackWithCompletionHandler:(WK_SWIFT_UI_ACTOR void (^_Nullable)(void))completionHandler API_AVAILABLE(macos(12.0), ios(15.0));
- (void)pauseAllMediaPlayback:(WK_SWIFT_UI_ACTOR void (^_Nullable)(void))completionHandler API_DEPRECATED_WITH_REPLACEMENT("pauseAllMediaPlaybackWithCompletionHandler:", macos(11.3, 12.0), ios(14.5, 15.0));
- (void)setAllMediaPlaybackSuspended:(BOOL)suspended completionHandler:(WK_SWIFT_UI_ACTOR void (^_Nullable)(void))completionHandler API_AVAILABLE(macos(12.0), ios(15.0));
- (void)resumeAllMediaPlayback:(WK_SWIFT_UI_ACTOR void (^ _Nullable)(void))completionHandler API_DEPRECATED_WITH_REPLACEMENT("setAllMediaPlaybackSuspended:completionHandler:", macos(11.3, 12.0), ios(14.5, 15.0));
- (void)suspendAllMediaPlayback:(WK_SWIFT_UI_ACTOR void (^_Nullable)(void))completionHandler API_DEPRECATED_WITH_REPLACEMENT("setAllMediaPlaybackSuspended:completionHandler:", macos(11.3, 12.0), ios(14.5, 15.0));
- (void)requestMediaPlaybackStateWithCompletionHandler:(WK_SWIFT_UI_ACTOR void (^)(WKMediaPlaybackState))completionHandler API_AVAILABLE(macos(12.0), ios(15.0));
- (void)requestMediaPlaybackState:(WK_SWIFT_UI_ACTOR void (^)(WKMediaPlaybackState))completionHandler API_DEPRECATED_WITH_REPLACEMENT("requestMediaPlaybackStateWithCompletionHandler:", macos(11.3, 12.0), ios(14.5, 15.0));
@property (nonatomic, readonly) WKMediaCaptureState cameraCaptureState API_AVAILABLE(macos(12.0), ios(15.0));
@property (nonatomic, readonly) WKMediaCaptureState microphoneCaptureState API_AVAILABLE(macos(12.0), ios(15.0));
- (void)setCameraCaptureState:(WKMediaCaptureState)state completionHandler:(WK_SWIFT_UI_ACTOR void (^_Nullable)(void))completionHandler API_AVAILABLE(macos(12.0), ios(15.0));
- (void)setMicrophoneCaptureState:(WKMediaCaptureState)state completionHandler:(WK_SWIFT_UI_ACTOR void (^_Nullable)(void))completionHandler API_AVAILABLE(macos(12.0), ios(15.0));
- (void)takeSnapshotWithConfiguration:(nullable WKSnapshotConfiguration *)snapshotConfiguration completionHandler:(WK_SWIFT_UI_ACTOR void (^)(UIImage * _Nullable snapshotImage, NSError * _Nullable error))completionHandler WK_SWIFT_ASYNC_NAME(takeSnapshot(configuration:)) API_AVAILABLE(ios(11.0));
- (void)createPDFWithConfiguration:(nullable WKPDFConfiguration *)pdfConfiguration completionHandler:(WK_SWIFT_UI_ACTOR void (^)(NSData * _Nullable pdfDocumentData, NSError * _Nullable error))completionHandler NS_REFINED_FOR_SWIFT API_AVAILABLE(macos(11.0), ios(14.0));
- (void)createWebArchiveDataWithCompletionHandler:(WK_SWIFT_UI_ACTOR void (^)(NSData * _Nullable, NSError * _Nullable))completionHandler NS_REFINED_FOR_SWIFT API_AVAILABLE(macos(11.0), ios(14.0));
@property (nonatomic) BOOL allowsBackForwardNavigationGestures;
@property (nullable, nonatomic, copy) NSString *customUserAgent API_AVAILABLE(macos(10.11), ios(9.0));
@property (nonatomic) BOOL allowsLinkPreview API_AVAILABLE(macos(10.11), ios(9.0));
@property (nonatomic, readonly, strong) UIScrollView *scrollView;
@property (nonatomic) CGFloat pageZoom API_AVAILABLE(macos(11.0), ios(14.0));
- (void)findString:(NSString *)string withConfiguration:(nullable WKFindConfiguration *)configuration completionHandler:(WK_SWIFT_UI_ACTOR void (^)(WKFindResult *result))completionHandler NS_REFINED_FOR_SWIFT API_AVAILABLE(macos(11.0), ios(14.0));
- (void)startDownloadUsingRequest:(NSURLRequest *)request completionHandler:(WK_SWIFT_UI_ACTOR void(^)(WKDownload *))completionHandler API_AVAILABLE(macos(11.3), ios(14.5));
- (void)resumeDownloadFromResumeData:(NSData *)resumeData completionHandler:(WK_SWIFT_UI_ACTOR void(^)(WKDownload *))completionHandler API_AVAILABLE(macos(11.3), ios(14.5));
@property (nonatomic, nullable, copy) NSString *mediaType API_AVAILABLE(macos(11.0), ios(14.0));
@property (nonatomic, nullable, copy) id interactionState API_AVAILABLE(macos(12.0), ios(15.0));
@property (nonatomic, readonly) BOOL isBlockedByScreenTime API_AVAILABLE(macos(26.0), ios(26.0)) API_UNAVAILABLE(visionos);
@property (nonatomic, readonly, nullable) UIColor *themeColor API_AVAILABLE(ios(15.0));
@property (nonatomic, null_resettable, copy) UIColor *underPageBackgroundColor API_AVAILABLE(ios(15.0));
@property (nonatomic, readonly) WKFullscreenState fullscreenState API_AVAILABLE(macos(13.0), ios(16.0));
@property (nonatomic, readonly) UIEdgeInsets minimumViewportInset API_AVAILABLE(ios(15.5));
@property (nonatomic, readonly) UIEdgeInsets maximumViewportInset API_AVAILABLE(ios(15.5));
@property (nonatomic, readwrite, getter=isFindInteractionEnabled) BOOL findInteractionEnabled API_AVAILABLE(ios(16.0));
@property (nonatomic, nullable, readonly) UIFindInteraction *findInteraction API_AVAILABLE(ios(16.0));
@property (strong, nonatomic) UIConversationContext *conversationContext API_AVAILABLE(ios(26.0)) API_UNAVAILABLE(tvos, watchos, visionos, macCatalyst);
@property (nonatomic, getter=isInspectable) BOOL inspectable NS_SWIFT_NAME(isInspectable) API_AVAILABLE(macos(13.3), ios(16.4));
@property (nonatomic, readonly, getter=isWritingToolsActive) BOOL writingToolsActive API_AVAILABLE(macos(15.0), ios(18.0), visionos(2.4));
typedef NS_OPTIONS(NSUInteger, WKWebViewDataType) {
    WKWebViewDataTypeSessionStorage = 1 << 0
} API_AVAILABLE(macos(26.0), ios(26.0), visionos(26.0));
- (void)fetchDataOfTypes:(WKWebViewDataType)dataTypes completionHandler:(WK_SWIFT_UI_ACTOR void (^)(NSData * _Nullable data, NSError * _Nullable error))completionHandler NS_SWIFT_NAME(fetchData(of:completionHandler:)) API_AVAILABLE(macos(26.0), ios(26.0), visionos(26.0));
- (void)restoreData:(NSData *)data completionHandler:(WK_SWIFT_UI_ACTOR void(^)(NSError * _Nullable error))completionHandler NS_SWIFT_NAME(restoreData(_:completionHandler:)) API_AVAILABLE(macos(26.0), ios(26.0), visionos(26.0));
@property (nonatomic) UIEdgeInsets obscuredContentInsets API_AVAILABLE(ios(26.0), visionos(26.0));
@end
@interface WKWebView (WKDeprecated)
@property (nonatomic, readonly, copy) NSArray *certificateChain API_DEPRECATED_WITH_REPLACEMENT("serverTrust", macos(10.11, 10.12), ios(9.0, 10.0));
@end
