// Extract of /System/Library/Frameworks/UIKit.framework/Headers/UIScrollView.h, iphonesimulator SDK 27.1
#if (defined(USE_UIKIT_PUBLIC_HEADERS) && USE_UIKIT_PUBLIC_HEADERS) || !__has_include(<UIKitCore/UIScrollView.h>)
typedef NS_ENUM(NSInteger, UIScrollViewIndicatorStyle) {
    UIScrollViewIndicatorStyleDefault,     // Automatically switches appearance based on the user interface style
    UIScrollViewIndicatorStyleBlack,       // Dark indicator, for use on light backgrounds
    UIScrollViewIndicatorStyleWhite        // Light indicator, for use on dark backgrounds
} API_UNAVAILABLE(watchos);
typedef NS_ENUM(NSInteger, UIScrollViewKeyboardDismissMode) {
    UIScrollViewKeyboardDismissModeNone,
    UIScrollViewKeyboardDismissModeOnDrag,      // dismisses the keyboard when a drag begins
    UIScrollViewKeyboardDismissModeInteractive, // the keyboard follows the dragging touch off screen, and may be pulled upward again to cancel the dismiss
    UIScrollViewKeyboardDismissModeOnDragWithAccessory,       // dismisses both keyboard and accessory in the style of UIScrollViewKeyboardDismissModeOnDrag
    UIScrollViewKeyboardDismissModeInteractiveWithAccessory   // dismisses both keyboard and accessory in the style of UIScrollViewKeyboardDismissModeInteractive
} API_AVAILABLE(ios(7.0)) API_UNAVAILABLE(visionos, watchos);
typedef NS_ENUM(NSInteger, UIScrollViewIndexDisplayMode) {
    UIScrollViewIndexDisplayModeAutomatic,    // the index will show or hide automatically as needed
    UIScrollViewIndexDisplayModeAlwaysHidden, // the index will never be displayed
} API_AVAILABLE(tvos(10.2)) API_UNAVAILABLE(watchos);
typedef NS_ENUM(NSInteger, UIScrollViewContentInsetAdjustmentBehavior) {
    UIScrollViewContentInsetAdjustmentAutomatic, // Similar to .scrollableAxes, but for backward compatibility will also adjust the top & bottom contentInset when the scroll view is owned by a view controller with automaticallyAdjustsScrollViewInsets = YES inside a navigation controller, regardless of whether the scroll view is scrollable
    UIScrollViewContentInsetAdjustmentScrollableAxes, // Edges for scrollable axes are adjusted (i.e., contentSize.width/height > frame.size.width/height or alwaysBounceHorizontal/Vertical = YES)
    UIScrollViewContentInsetAdjustmentNever, // contentInset is not adjusted
    UIScrollViewContentInsetAdjustmentAlways, // contentInset is always adjusted by the scroll view's safeAreaInsets
} API_AVAILABLE(ios(11.0), tvos(11.0)) API_UNAVAILABLE(watchos);
@interface UIScrollEdgeEffectStyle : NSObject
@property (nonatomic, readonly, class) UIScrollEdgeEffectStyle *automaticStyle;
@property (nonatomic, readonly, class) UIScrollEdgeEffectStyle *softStyle;
@property (nonatomic, readonly, class) UIScrollEdgeEffectStyle *hardStyle;
@end
@interface UIScrollEdgeEffect : NSObject
@property (nonatomic, strong) UIScrollEdgeEffectStyle *style;
@property (nonatomic, getter=isHidden) BOOL hidden;
@end
@interface UIScrollView : UIView <NSCoding, UIFocusItemScrollableContainer>
@property(nonatomic)         CGPoint                      contentOffset;                  // default CGPointZero
@property(nonatomic)         CGSize                       contentSize;                    // default CGSizeZero
@property(nonatomic)         UIEdgeInsets                 contentInset;                   // default UIEdgeInsetsZero. add additional scroll area around content
@property (nonatomic) CGPoint contentAlignmentPoint API_AVAILABLE(ios(17.4)) API_UNAVAILABLE(watchos);
@property(nonatomic, readonly) UIEdgeInsets adjustedContentInset API_AVAILABLE(ios(11.0), tvos(11.0)) API_UNAVAILABLE(watchos);
@property(nonatomic) UIScrollViewContentInsetAdjustmentBehavior contentInsetAdjustmentBehavior API_AVAILABLE(ios(11.0), tvos(11.0)) API_UNAVAILABLE(watchos);
@property(nonatomic) BOOL automaticallyAdjustsScrollIndicatorInsets API_AVAILABLE(ios(13.0), tvos(13.0)) API_UNAVAILABLE(watchos);
@property(nonatomic,readonly,strong) UILayoutGuide *contentLayoutGuide API_AVAILABLE(ios(11.0), tvos(11.0)) API_UNAVAILABLE(watchos);
@property(nonatomic,readonly,strong) UILayoutGuide *frameLayoutGuide API_AVAILABLE(ios(11.0), tvos(11.0)) API_UNAVAILABLE(watchos);
@property(nullable,nonatomic,weak) id<UIScrollViewDelegate>        delegate;                       // default nil. weak reference
@property(nonatomic,getter=isDirectionalLockEnabled) BOOL directionalLockEnabled;         // default NO. if YES, try to lock vertical or horizontal scrolling while dragging
@property (nonatomic) BOOL bounces;
@property (nonatomic) BOOL bouncesHorizontally API_AVAILABLE(ios(17.4)) API_UNAVAILABLE(watchos);
@property (nonatomic) BOOL bouncesVertically API_AVAILABLE(ios(17.4)) API_UNAVAILABLE(watchos);
@property(nonatomic)         BOOL                         alwaysBounceVertical;           // default NO. if YES and bounces is YES, even if content is smaller than bounds, allow drag vertically
@property(nonatomic)         BOOL                         alwaysBounceHorizontal;         // default NO. if YES and bounces is YES, even if content is smaller than bounds, allow drag horizontally
@property(nonatomic,getter=isPagingEnabled) BOOL          pagingEnabled API_UNAVAILABLE(tvos);// default NO. if YES, stop on multiples of view bounds
@property(nonatomic,getter=isScrollEnabled) BOOL          scrollEnabled;                  // default YES. turn off any dragging temporarily
@property (nonatomic) BOOL transfersHorizontalScrollingToParent API_AVAILABLE(ios(17.4)) API_UNAVAILABLE(watchos);
@property (nonatomic) BOOL transfersVerticalScrollingToParent API_AVAILABLE(ios(17.4)) API_UNAVAILABLE(watchos);
@property(nonatomic)         BOOL                         showsVerticalScrollIndicator;   // default YES. show indicator while we are tracking. fades out after tracking
@property(nonatomic)         BOOL                         showsHorizontalScrollIndicator; // default YES. show indicator while we are tracking. fades out after tracking
@property(nonatomic)         UIScrollViewIndicatorStyle   indicatorStyle;                 // default is UIScrollViewIndicatorStyleDefault
@property(nonatomic)         UIEdgeInsets                 verticalScrollIndicatorInsets API_AVAILABLE(ios(11.1), tvos(11.1)) API_UNAVAILABLE(watchos); // default is UIEdgeInsetsZero.
@property(nonatomic)         UIEdgeInsets                 horizontalScrollIndicatorInsets API_AVAILABLE(ios(11.1), tvos(11.1)) API_UNAVAILABLE(watchos); // default is UIEdgeInsetsZero.
@property(nonatomic)         UIEdgeInsets                 scrollIndicatorInsets; // use the setter only, as a convenience for setting both verticalScrollIndicatorInsets and horizontalScrollIndicatorInsets to the same value. if those properties have been set to different values, the return value of this getter (deprecated) is undefined.
@property(nonatomic)         UIScrollViewDecelerationRate decelerationRate API_AVAILABLE(ios(3.0));
@property(nonatomic)         UIScrollViewIndexDisplayMode indexDisplayMode API_AVAILABLE(tvos(10.2)) API_UNAVAILABLE(watchos);
- (void)withScrollIndicatorsShownForContentOffsetChanges:(void (NS_NOESCAPE ^)(void))changes API_AVAILABLE(ios(17.4)) API_UNAVAILABLE(watchos);
@property (nonatomic, readonly) UIScrollEdgeEffect *topEdgeEffect API_AVAILABLE(ios(26.0), tvos(26.0), visionos(26.0)) API_UNAVAILABLE(watchos);
@property (nonatomic, readonly) UIScrollEdgeEffect *leftEdgeEffect API_AVAILABLE(ios(26.0), tvos(26.0), visionos(26.0)) API_UNAVAILABLE(watchos);
@property (nonatomic, readonly) UIScrollEdgeEffect *bottomEdgeEffect API_AVAILABLE(ios(26.0), tvos(26.0), visionos(26.0)) API_UNAVAILABLE(watchos);
@property (nonatomic, readonly) UIScrollEdgeEffect *rightEdgeEffect API_AVAILABLE(ios(26.0), tvos(26.0), visionos(26.0)) API_UNAVAILABLE(watchos);
@property(nonatomic, readonly, getter=isTracking) BOOL tracking;
@property(nonatomic, readonly, getter=isDragging) BOOL dragging;
@property(nonatomic, readonly, getter=isDecelerating) BOOL decelerating;
@property (nonatomic, readonly, getter=isScrollAnimating) BOOL scrollAnimating API_AVAILABLE(ios(17.4)) API_UNAVAILABLE(watchos);
@property(nonatomic) BOOL delaysContentTouches;       // default is YES. if NO, we immediately call -touchesShouldBegin:withEvent:inContentView:. this has no effect on presses
@property(nonatomic) BOOL canCancelContentTouches;    // default is YES. if NO, then once we start tracking, we don't try to drag if the touch moves. this has no effect on presses
@property(nonatomic) CGFloat minimumZoomScale;     // default is 1.0
@property(nonatomic) CGFloat maximumZoomScale;     // default is 1.0. must be > minimum zoom scale to enable zooming
@property(nonatomic) CGFloat zoomScale API_AVAILABLE(ios(3.0));            // default is 1.0
@property (nonatomic) BOOL bouncesZoom;
@property (nonatomic, readonly, getter=isZooming) BOOL zooming;
@property (nonatomic, readonly, getter=isZoomBouncing) BOOL zoomBouncing;
@property (nonatomic, readonly, getter=isZoomAnimating) BOOL zoomAnimating API_AVAILABLE(ios(17.4)) API_UNAVAILABLE(watchos);
@property (nonatomic) BOOL scrollsToTop API_UNAVAILABLE(tvos);
@property(nonatomic, readonly) UIPanGestureRecognizer *panGestureRecognizer API_AVAILABLE(ios(5.0));
@property(nullable, nonatomic, readonly) UIPinchGestureRecognizer *pinchGestureRecognizer API_AVAILABLE(ios(5.0)) API_UNAVAILABLE(tvos);
@property(nonatomic, readonly) UIGestureRecognizer *directionalPressGestureRecognizer API_DEPRECATED("Configuring the panGestureRecognizer for indirect scrolling automatically supports directional presses now, so this property is no longer useful.", tvos(9.0, 11.0)) API_UNAVAILABLE(watchos);
@property(nonatomic) UIScrollViewKeyboardDismissMode keyboardDismissMode API_AVAILABLE(ios(7.0)) API_UNAVAILABLE(visionos); // default is UIScrollViewKeyboardDismissModeNone
@property (nonatomic, strong, nullable) UIRefreshControl *refreshControl API_AVAILABLE(ios(10.0)) API_UNAVAILABLE(tvos, watchos);
@property (nonatomic, assign) BOOL allowsKeyboardScrolling API_AVAILABLE(ios(17.0)) API_UNAVAILABLE(watchos) API_UNAVAILABLE(tvos);
@property (nonatomic) UIAxis lookToScrollAxes API_AVAILABLE(visionos(26.0)) API_UNAVAILABLE(ios, watchos, tvos);
@end
@end
#else
#endif
