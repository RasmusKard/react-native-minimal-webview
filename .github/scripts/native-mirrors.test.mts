import assert from 'node:assert/strict';
import { test } from 'node:test';

import { coercedObjects, completionShapes } from './native-mirrors.mts';

await test('coercedObjects reads every encoding coerce matches, in any literal form, and nothing outside it', () => {
  const swift = `
enum PlatformSettings {
  private static func coerce(_ value: Any, _ type: String) -> Any? {
    switch type {
    case "@\\"NSString\\"", "@\\"NSURL\\"":
      return value as? String
    case #"@"UIColor""#:
      return value
    case _ where type.hasPrefix("{"):
      return nil
    default:
      return nil
    }
  }

  static func describe(_ type: String) -> String {
    switch type {
    case "@\\"NSData\\"": return "data"
    default: return type
    }
  }
}
`;
  assert.deepEqual(coercedObjects(swift), ['NSString', 'NSURL', 'UIColor']);
});

await test('completionShapes reads every name MRWBlock compares, and nothing outside it', () => {
  const objc = `
static id MRWBlock(NSString *completion, void (^resolve)(id, NSString *)) {
  if ([completion isEqualToString:@"void"]) return [^{ resolve(NSNull.null, nil); } copy];
  if ([completion isEqual:@"value"]) return [^(id value) { resolve(value, nil); } copy];
  return nil;
}

static BOOL MRWIsKnown(NSString *name) {
  return [name isEqualToString:@"other"];
}
`;
  assert.deepEqual(completionShapes(objc), ['value', 'void']);
});
