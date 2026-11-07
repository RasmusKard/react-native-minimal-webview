// Extract of /System/Library/Frameworks/WebKit.framework/Headers/WKDataDetectorTypes.h, iphonesimulator SDK 27.1
typedef NS_OPTIONS(NSUInteger, WKDataDetectorTypes) {
    WKDataDetectorTypeNone = 0,
    WKDataDetectorTypePhoneNumber = 1 << 0,
    WKDataDetectorTypeLink = 1 << 1,
    WKDataDetectorTypeAddress = 1 << 2,
    WKDataDetectorTypeCalendarEvent = 1 << 3,
    WKDataDetectorTypeTrackingNumber = 1 << 4,
    WKDataDetectorTypeFlightNumber = 1 << 5,
    WKDataDetectorTypeLookupSuggestion = 1 << 6,
    WKDataDetectorTypeAll = NSUIntegerMax,

    WKDataDetectorTypeSpotlightSuggestion API_DEPRECATED_WITH_REPLACEMENT("WKDataDetectorTypeLookupSuggestion", ios(10.0, 10.0)) = WKDataDetectorTypeLookupSuggestion,
} API_AVAILABLE(ios(10.0));
