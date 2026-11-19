#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Runs `block` and returns the Objective-C exception it raised as `name: reason`, or nil. Swift can't catch those;
/// Key-Value Coding raises one for an unknown key or a value a setter rejects.
FOUNDATION_EXPORT NSString *_Nullable MRWCatchException(void (NS_NOESCAPE ^block)(void)) NS_REFINED_FOR_SWIFT;

/// Calls `selector` on `target` with the JSON `args` and resolves with the result as `MRWJsonable` makes it, or with
/// why it couldn't.
///
/// `args` are set by the method signature's type encodings, in the forms WebViewRef.call's @param lists.
///
/// A selector whose last argument is a block gets the shape `completion` names, and the block resolves, with the
/// error's description as the error:
/// - `void`: `(void)`
/// - `value`: `(id)`
/// - `valueError`: `(id, NSError *)`
/// - `error`: `(NSError *)`
/// - `number`: `(NSInteger)`
///
/// Rejects, never raises, for:
/// - an unknown selector, a block selector without a `completion`, or a wrong argument count;
/// - an argument that doesn't fit, such as a tagged object that can't be made (invalid base64, a cookie without a name,
///   value, path, and domain or origin URL);
/// - an exception the method, or making its result JSON, raises.
///
/// A wrong block shape or an object argument of the wrong class is undefined behavior.
FOUNDATION_EXPORT void MRWInvoke(id target, SEL selector, NSArray *args, NSString *_Nullable completion,
                                 void (^resolve)(id _Nullable result, NSString *_Nullable error)) NS_REFINED_FOR_SWIFT;

/// `value` as JSON, in the forms WebViewRef.call's @returns lists; anything else, and nil, is null.
FOUNDATION_EXPORT id MRWJsonable(id _Nullable value) NS_REFINED_FOR_SWIFT;

/// `json` as the struct the type encoding `type` names, in the forms WebViewRef.call's @param lists; nil for another
/// type or a value that doesn't fit.
FOUNDATION_EXPORT NSValue *_Nullable MRWStructValue(const char *type, id json) NS_REFINED_FOR_SWIFT;

NS_ASSUME_NONNULL_END
