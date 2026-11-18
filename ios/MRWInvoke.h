#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Calls `selector` on `target` with the JSON `args` and resolves with the result as `MRWJsonable` makes it, or with
/// why it couldn't.
///
/// `args` are set by the method signature's type encodings:
/// - booleans, numbers and strings as themselves, and nil from null;
/// - the four structs (UIEdgeInsets, CGPoint, CGSize, CGRect) from objects;
/// - `{ set: [] }`, `{ date: seconds }`, `{ data: base64 }` and `{ cookie: properties }` for an NSSet, NSDate, NSData
///   or NSHTTPCookie;
/// - any other object as is.
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

/// `value` as JSON: numbers, strings, URLs as strings, dates as seconds since 1970, NSData and UIImage (PNG) as
/// base64, the four struct NSValues (UIEdgeInsets, CGPoint, CGSize, CGRect) as objects, an NSHTTPCookie as its
/// `properties`, lists, sets and dictionaries of them; anything else, and nil, is null.
FOUNDATION_EXPORT id MRWJsonable(id _Nullable value) NS_REFINED_FOR_SWIFT;

NS_ASSUME_NONNULL_END
