#import "MRWInvoke.h"
#import <UIKit/UIKit.h>

NSString *MRWCatchException(void (NS_NOESCAPE ^block)(void)) {
  @try {
    block();
    return nil;
  } @catch (NSException *exception) {
    return [NSString stringWithFormat:@"%@: %@", exception.name, exception.reason ?: @""];
  }
}

/// The JSON keys of a struct `call` and the settings carry, in field order, by its type encoding; nil for any other.
/// Each one's fields are doubles (CGFloat), so its bytes are the values in that order.
static NSArray<NSString *> *MRWStructKeys(const char *type) {
  if (strcmp(type, @encode(UIEdgeInsets)) == 0) return @[@"top", @"left", @"bottom", @"right"];
  if (strcmp(type, @encode(CGPoint)) == 0) return @[@"x", @"y"];
  if (strcmp(type, @encode(CGSize)) == 0) return @[@"width", @"height"];
  if (strcmp(type, @encode(CGRect)) == 0) return @[@"x", @"y", @"width", @"height"];
  return nil;
}

static NSDictionary *MRWStruct(NSValue *value) {
  NSArray<NSString *> *keys = MRWStructKeys(value.objCType);
  if (!keys) return nil;
  double n[4];
  [value getValue:n size:keys.count * sizeof(double)];
  NSMutableDictionary *json = [NSMutableDictionary new];
  for (NSUInteger i = 0; i < keys.count; i++) json[keys[i]] = @(n[i]);
  return json;
}

id MRWJsonable(id value) {
  if ([value isKindOfClass:NSNumber.class] || [value isKindOfClass:NSString.class]) return value;
  if ([value isKindOfClass:NSURL.class]) return [value absoluteString];
  if ([value isKindOfClass:NSDate.class]) return @([value timeIntervalSince1970]);
  if ([value isKindOfClass:NSData.class]) return [value base64EncodedStringWithOptions:0];
  if ([value isKindOfClass:UIImage.class]) return MRWJsonable(UIImagePNGRepresentation(value));
  if ([value isKindOfClass:NSHTTPCookie.class]) return MRWJsonable([value properties]);
  if ([value isKindOfClass:NSArray.class] || [value isKindOfClass:NSSet.class]) {
    NSMutableArray *list = [NSMutableArray new];
    for (id item in value) [list addObject:MRWJsonable(item)];
    return list;
  }
  if ([value isKindOfClass:NSDictionary.class]) {
    NSMutableDictionary *object = [NSMutableDictionary new];
    for (id key in value) object[[key description]] = MRWJsonable(value[key]);
    return object;
  }
  if ([value isKindOfClass:NSValue.class]) return MRWStruct(value) ?: NSNull.null;
  return NSNull.null;
}

/// A JSON argument for an `@` parameter: nil for null, the tagged objects as their class (nil for one that can't be
/// made), the rest as is.
static id MRWObject(id json) {
  if (json == NSNull.null) return nil;
  if (![json isKindOfClass:NSDictionary.class] || [json count] != 1) return json;
  id set = json[@"set"], date = json[@"date"], data = json[@"data"], cookie = json[@"cookie"];
  if ([set isKindOfClass:NSArray.class]) return [NSSet setWithArray:set];
  if ([date isKindOfClass:NSNumber.class]) return [NSDate dateWithTimeIntervalSince1970:[date doubleValue]];
  if ([data isKindOfClass:NSString.class]) return [[NSData alloc] initWithBase64EncodedString:data options:0];
  if ([cookie isKindOfClass:NSDictionary.class]) {
    // A `Path` that isn't a string raises instead of returning nil.
    __block NSHTTPCookie *made = nil;
    MRWCatchException(^{ made = [NSHTTPCookie cookieWithProperties:cookie]; });
    return made;
  }
  return json;
}

/// Reads `keys` of `object` as numbers into `out`; NO when `keys` is nil or one is missing or not a number.
static BOOL MRWNumbers(id object, NSArray<NSString *> *keys, double *out) {
  if (!keys || ![object isKindOfClass:NSDictionary.class]) return NO;
  for (NSUInteger i = 0; i < keys.count; i++) {
    id number = object[keys[i]];
    if (![number isKindOfClass:NSNumber.class]) return NO;
    out[i] = [number doubleValue];
  }
  return YES;
}

NSValue *MRWStructValue(const char *type, id json) {
  double n[4];
  return MRWNumbers(json, MRWStructKeys(type), n) ? [NSValue valueWithBytes:n objCType:type] : nil;
}

#define MRW_SET(ctype, expr) { ctype v = (expr); [invocation setArgument:&v atIndex:index]; return YES; }

/// Sets argument `index` from the JSON `value` as the type encoding `type` wants it, or returns NO when it doesn't fit.
/// An object made here goes into `keep`: the invocation holds it unretained until `retainArguments`.
static BOOL MRWSetArgument(NSInvocation *invocation, NSUInteger index, const char *type, id value, NSMutableArray *keep) {
  NSNumber *number = [value isKindOfClass:NSNumber.class] ? value : nil;
  BOOL isBool = number && CFGetTypeID((__bridge CFTypeRef)number) == CFBooleanGetTypeID();
  double n[4];
  switch (type[0]) {
    case 'B': if (isBool) MRW_SET(bool, number.boolValue) break;
    case 'c': if (isBool) MRW_SET(signed char, number.boolValue) break;
    case 's': if (number && !isBool) MRW_SET(short, number.shortValue) break;
    case 'S': if (number && !isBool) MRW_SET(unsigned short, number.unsignedShortValue) break;
    case 'i': if (number && !isBool) MRW_SET(int, number.intValue) break;
    case 'I': if (number && !isBool) MRW_SET(unsigned int, number.unsignedIntValue) break;
    case 'l': if (number && !isBool) MRW_SET(long, number.longValue) break;
    case 'L': if (number && !isBool) MRW_SET(unsigned long, number.unsignedLongValue) break;
    case 'q': if (number && !isBool) MRW_SET(long long, number.longLongValue) break;
    case 'Q': if (number && !isBool) MRW_SET(unsigned long long, number.unsignedLongLongValue) break;
    case 'f': if (number && !isBool) MRW_SET(float, number.floatValue) break;
    case 'd': if (number && !isBool) MRW_SET(double, number.doubleValue) break;
    case '@': {
      if (type[1] == '?') break;
      id object = MRWObject(value);
      if (!object && value != NSNull.null) break;
      if (object) [keep addObject:object];
      MRW_SET(id, object)
    }
    case '{':
      if (MRWNumbers(value, MRWStructKeys(type), n)) { [invocation setArgument:n atIndex:index]; return YES; }
      break;
    default: break;
  }
  return NO;
}

#define MRW_GET(ctype, box) { ctype v; [invocation getReturnValue:&v]; return (box); }

/// The invocation's return value as an object for `MRWJsonable`; null for void and for what JSON can't carry.
static id MRWReturnValue(NSInvocation *invocation) {
  const char *type = invocation.methodSignature.methodReturnType;
  switch (type[0]) {
    case 'B': MRW_GET(bool, @(v))
    case 'c': MRW_GET(signed char, @((BOOL)v))
    case 's': MRW_GET(short, @(v))
    case 'S': MRW_GET(unsigned short, @(v))
    case 'i': MRW_GET(int, @(v))
    case 'I': MRW_GET(unsigned int, @(v))
    case 'l': MRW_GET(long, @(v))
    case 'L': MRW_GET(unsigned long, @(v))
    case 'q': MRW_GET(long long, @(v))
    case 'Q': MRW_GET(unsigned long long, @(v))
    case 'f': MRW_GET(float, @(v))
    case 'd': MRW_GET(double, @(v))
    case '@': { __unsafe_unretained id v = nil; [invocation getReturnValue:&v]; return v; }
    case '{': {
      if (!MRWStructKeys(type)) return NSNull.null;
      double n[4];
      [invocation getReturnValue:n];
      return [NSValue valueWithBytes:n objCType:type];
    }
    default: return NSNull.null;
  }
}

/// A completion block of the shape `completion` names, resolving `resolve`; nil for an unknown shape.
static id MRWBlock(NSString *completion, void (^resolve)(id, NSString *)) {
  if ([completion isEqualToString:@"void"]) return [^{ resolve(NSNull.null, nil); } copy];
  if ([completion isEqualToString:@"value"]) return [^(id value) { resolve(value, nil); } copy];
  if ([completion isEqualToString:@"valueError"]) {
    return [^(id value, NSError *error) { resolve(value, error.localizedDescription); } copy];
  }
  if ([completion isEqualToString:@"error"]) return [^(NSError *error) { resolve(NSNull.null, error.localizedDescription); } copy];
  if ([completion isEqualToString:@"number"]) return [^(NSInteger value) { resolve(@(value), nil); } copy];
  return nil;
}

void MRWInvoke(id target, SEL selector, NSArray *args, NSString *completion, void (^resolve)(id, NSString *)) {
  NSString *name = NSStringFromSelector(selector);
  NSMethodSignature *signature = [target methodSignatureForSelector:selector];
  if (!signature) return resolve(nil, [NSString stringWithFormat:@"%@ has no method %@", [target class], name]);
  NSUInteger count = signature.numberOfArguments - 2;
  BOOL takesBlock = count > 0 && strcmp([signature getArgumentTypeAtIndex:count + 1], "@?") == 0;
  NSUInteger expected = takesBlock ? count - 1 : count;
  if (args.count != expected) {
    return resolve(nil, [NSString stringWithFormat:@"%@ takes %lu arguments, got %lu", name, (unsigned long)expected, (unsigned long)args.count]);
  }
  // The method may call its block before returning, or raise after calling it: the first settlement counts.
  // The result is made JSON here, inside the catch: walking a KVC proxy or a raising getter rejects.
  __block BOOL settled = NO;
  void (^once)(id, NSString *) = ^(id result, NSString *error) {
    if (settled) return;
    settled = YES;
    __block id json = nil;
    NSString *raised = MRWCatchException(^{ json = MRWJsonable(result); });
    resolve(raised ? nil : json, error ?: raised);
  };
  id block = takesBlock ? MRWBlock(completion, once) : nil;
  if (takesBlock && !block) return once(nil, @"the method takes a completion handler this package's SDK headers don't list: write a native hook");
  NSInvocation *invocation = [NSInvocation invocationWithMethodSignature:signature];
  NSMutableArray *keep = [NSMutableArray new];
  invocation.target = target;
  invocation.selector = selector;
  for (NSUInteger i = 0; i < expected; i++) {
    const char *type = [signature getArgumentTypeAtIndex:i + 2];
    if (!MRWSetArgument(invocation, i + 2, type, args[i], keep)) {
      return once(nil, [NSString stringWithFormat:@"argument %lu of %@ (%s) can't take %@", (unsigned long)i + 1, name, type, args[i]]);
    }
  }
  if (block) [invocation setArgument:&block atIndex:count + 1];
  [invocation retainArguments];
  NSString *raised = MRWCatchException(^{ [invocation invoke]; });
  if (raised) return once(nil, raised);
  if (!block) once(MRWReturnValue(invocation), nil);
}
