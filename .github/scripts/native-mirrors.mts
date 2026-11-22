const names = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].map((m) => m[1] ?? m[2] ?? '').sort();

function body(source: string, signature: string) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.includes(signature));
  const end = lines.indexOf(`${lines[start]?.match(/^\s*/)?.[0]}}`, start);
  if (start < 0 || end < 0) throw new Error(`no ${signature} ... } in the source`);
  return lines.slice(start, end + 1).join('\n');
}

/**
 * The object classes whose type encodings `coerce` in a PlatformSettings.swift source names, in a plain or raw string
 * literal. Throws when the source has no `func coerce(`.
 */
export const coercedObjects = (swift: string) =>
  names(body(swift, 'func coerce('), /@\\"(\w+)\\"|#"@"(\w+)""#/g);

/** The completion shapes `MRWBlock` in an MRWInvoke.m source compares against. Throws when it has no `MRWBlock(`. */
export const completionShapes = (objc: string) => names(body(objc, ' MRWBlock('), /@"(\w+)"/g);
