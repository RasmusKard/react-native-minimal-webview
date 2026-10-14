#import "MRWExceptions.h"

NSString *MRWCatchException(void (NS_NOESCAPE ^block)(void)) {
  @try {
    block();
    return nil;
  } @catch (NSException *exception) {
    return [NSString stringWithFormat:@"%@: %@", exception.name, exception.reason ?: @""];
  }
}
