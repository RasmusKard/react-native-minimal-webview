#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Calls `selector` on `target` with the JSON `args` set by the method signature's type encodings (booleans, numbers,
/// strings, the four structs from objects, nil from null; `{ set: [] }`, `{ date: seconds }`, `{ data: base64 }` and
/// `{ cookie: properties }` for an NSSet, NSDate, NSData or NSHTTPCookie, any other object as is), and resolves with
/// the result as `MRWJsonable` makes it, or with why it couldn't. A selector whose last argument is a block gets one of
/// the shape `completion` names: `void` `(void)`, `value` `(id)`, `valueError` `(id, NSError *)`, `error`
/// `(NSError *)` or `number` `(NSInteger)`; the block resolves, with the error's description as the error. Rejects,
/// never raises, for an unknown selector, a block selector without a `completion`, a wrong argument count, an argument
/// that doesn't fit (a tagged object that can't be made, such as invalid base64 or a cookie without a name, value,
/// domain and path) or an exception the method, or making its result JSON, raises. A wrong block shape or an object
/// argument of the wrong class is undefined behaviour.
FOUNDATION_EXPORT void MRWInvoke(id target, SEL selector, NSArray *args, NSString *_Nullable completion,
                                 void (^resolve)(id _Nullable result, NSString *_Nullable error));

/// `value` as JSON: numbers, strings, URLs as strings, dates as seconds since 1970, NSData and UIImage (PNG) as
/// base64, the four struct NSValues (UIEdgeInsets, CGPoint, CGSize, CGRect) as objects, an NSHTTPCookie as its
/// `properties`, lists, sets and dictionaries of them; anything else, and nil, is null.
FOUNDATION_EXPORT id MRWJsonable(id _Nullable value);

NS_ASSUME_NONNULL_END
