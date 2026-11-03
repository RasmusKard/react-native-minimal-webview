#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Runs `block` and returns the reason of the Objective-C exception it raised, or nil. Swift can't catch those;
/// Key-Value Coding raises one for an unknown key or a value a setter rejects.
FOUNDATION_EXPORT NSString *_Nullable MRWCatchException(void (NS_NOESCAPE ^block)(void)) NS_REFINED_FOR_SWIFT;

NS_ASSUME_NONNULL_END
