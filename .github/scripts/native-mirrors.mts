const names = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].map((m) => m[1] ?? m[2] ?? '').sort();

/** The object classes whose type encodings a PlatformSettings.swift source coerces. */
export const coercedObjects = (swift: string) => names(swift, /case "@\\"(\w+)\\"":/g);

/** The completion shapes an MRWInvoke.m source builds a block for. */
export const completionShapes = (objc: string) => names(objc, /isEqualToString:@"(\w+)"/g);
