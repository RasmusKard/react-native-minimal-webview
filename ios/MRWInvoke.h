#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Swift can't catch an Objective-C exception; Key-Value Coding raises one for an unknown key or a value a setter rejects.
FOUNDATION_EXPORT NSString *_Nullable MRWCatchException(void (NS_NOESCAPE ^block)(void)) NS_REFINED_FOR_SWIFT;

/// A wrong block shape or an object argument of the wrong class is undefined behavior.
FOUNDATION_EXPORT void MRWInvoke(id target, SEL selector, NSArray *args, NSString *_Nullable completion,
                                 void (^resolve)(id _Nullable result, NSString *_Nullable error)) NS_REFINED_FOR_SWIFT;

FOUNDATION_EXPORT id MRWJsonable(id _Nullable value) NS_REFINED_FOR_SWIFT;

FOUNDATION_EXPORT NSValue *_Nullable MRWStructValue(const char *type, id json) NS_REFINED_FOR_SWIFT;

NS_ASSUME_NONNULL_END
