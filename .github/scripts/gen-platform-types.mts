// Generates src/platform.generated.ts: the iOS and Android settings keys as TypeScript types, and the platforms'
// constants, and ios/PlatformCompletions.generated.swift: the completion-handler shape of each WebKit method `call`
// reaches. Both come from the vendored SDK extracts in platform-headers/. Run after editing this script or those
// extracts: node .github/scripts/gen-platform-types.mts (`--check` fails if either output is stale).
// `--import` refreshes platform-headers/ from the installed Xcode and Android SDKs and the API file of the
// androidx.webkit version android/build.gradle pins: the explicit step after an SDK or androidx.webkit upgrade.
// IOSConstants' names are the header names with their common prefix stripped: an SDK rename renames a constant.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { format } from 'oxfmt';

import oxfmtConfig from '../../oxfmt.config.mts';
import { coercedObjects, completionShapes } from './native-mirrors.mts';

const inputs = new URL('platform-headers/', import.meta.url);
const target = new URL('../../src/platform.generated.ts', import.meta.url);
const swiftTarget = new URL('../../ios/PlatformCompletions.generated.swift', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, inputs), 'utf8');

const WEBKIT_HEADERS = [
  'WKWebViewConfiguration',
  'WKPreferences',
  'WKWebpagePreferences',
  'WKWebView',
  'WKDataDetectorTypes',
  'WKWebsiteDataRecord',
];
const IOS_ROOTS = {
  configuration: 'WKWebViewConfiguration',
  preferences: 'WKPreferences',
  webpagePreferences: 'WKWebpagePreferences',
  webView: 'WKWebView',
  scrollView: 'UIScrollView',
};
const COMPLETION_ROOTS = {
  webView: 'WKWebView',
  websiteDataStore: 'WKWebsiteDataStore',
  httpCookieStore: 'WKHTTPCookieStore',
};
const ANDROID_CLASSES = ['WebSettings', 'WebView', 'CookieManager'];
const classBlock = (api: string, name: string) =>
  api.match(new RegExp(`\t<class name="${name}" [^]*?</class>\n`))?.[0] ?? '';
const IOS_DEFINES = [
  '-DTARGET_OS_IPHONE=1',
  '-DTARGET_OS_IOS=1',
  '-DTARGET_OS_OSX=0',
  '-DTARGET_OS_MACCATALYST=0',
  '-DTARGET_OS_VISION=0',
  '-D__IPHONE_OS_VERSION_MIN_REQUIRED=999999',
  '-D__MAC_OS_X_VERSION_MIN_REQUIRED=0',
  '-D__VISION_OS_VERSION_MIN_REQUIRED=0',
  '-U__swift__',
  '-DOS_OBJECT_USE_OBJC=1',
  '-DUSE_UIKIT_PUBLIC_HEADERS=1',
];
const ANDROIDX_API_DIR =
  'https://api.github.com/repos/androidx/androidx/contents/webkit/webkit/api?ref=androidx-main';
const pinnedWebkit = () => {
  const [, version, minor] = repoFile('android/build.gradle').match(
    /androidx\.webkit:webkit:((\d+\.\d+)\.\d+)/
  )!;
  return { version, minor };
};

async function importInputs() {
  const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'])
    .toString()
    .trim();
  const sdkVersion = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'])
    .toString()
    .trim();
  const frameworks = `${sdk}/System/Library/Frameworks`;
  const headers = [
    ...[...new Set([...WEBKIT_HEADERS, ...Object.values(COMPLETION_ROOTS)])].map(
      (name) => `${frameworks}/WebKit.framework/Headers/${name}.h`
    ),
    `${frameworks}/UIKit.framework/Headers/UIScrollView.h`,
  ];
  for (const path of headers) {
    let inEnum = false;
    let unresolvedIfs = 0;
    const lines = execFileSync('xcrun', ['unifdef', '-x', '2', ...IOS_DEFINES, path])
      .toString()
      .split('\n')
      .filter((line) => {
        unresolvedIfs += /^\s*#\s*if/.test(line) ? 1 : /^\s*#\s*endif\b/.test(line) ? -1 : 0;
        let keep = inEnum;
        if (inEnum) inEnum = !line.startsWith('}');
        else {
          inEnum = /^typedef NS_(ENUM|OPTIONS)\b/.test(line);
          keep =
            inEnum ||
            /^@(interface|end)\b|^@property\b|^- \(.*\^|^WK_EXTERN NSString \* const /.test(line);
        }
        if (keep && unresolvedIfs)
          throw new Error(
            `${path}: an #if unifdef can't resolve holds \`${line}\`; add its macro to IOS_DEFINES`
          );
        return keep;
      });
    const name = path.slice(path.lastIndexOf('/') + 1);
    writeFileSync(
      new URL(name, inputs),
      `// Extract of ${path.slice(sdk.length)}, iphonesimulator SDK ${sdkVersion}\n${lines.join('\n')}\n`
    );
  }
  const home = process.env['ANDROID_HOME'] ?? `${process.env['HOME']}/Library/Android/sdk`;
  const platforms = readdirSync(`${home}/platforms`).filter((d) => d.startsWith('android-'));
  const platform = `${home}/platforms/${platforms.sort((a, b) => parseFloat(a.slice(8)) - parseFloat(b.slice(8))).at(-1)}`;
  const api = readFileSync(`${platform}/data/api-versions.xml`, 'utf8');
  const classes = [
    ...ANDROID_CLASSES.map((c) => classBlock(api, `android/webkit/${c}`)),
    // Of View, only the scroll setters WebView inherits (overScrollMode, the scroll bars, nested scrolling): its other
    // hundred setters (alpha, visibility, translation) are React Native's business.
    classBlock(api, 'android/view/View')
      .split('\n')
      .filter((line) => !line.startsWith('\t\t') || /^\t\t<method name="set\w*scroll/i.test(line))
      .join('\n'),
  ];
  writeFileSync(
    new URL('android-webkit-api.xml', inputs),
    `<!-- Extract of ${platform.slice(home.length)}/data/api-versions.xml; of View, only its scroll setters -->\n${classes.join('')}`
  );
  const constants = execFileSync('javap', [
    '-constants',
    '-cp',
    `${platform}/android.jar`,
    ...ANDROID_CLASSES.map((c) => `android.webkit.${c}`),
  ]);
  writeFileSync(new URL('android-webkit-constants.txt', inputs), constants);
  // androidx freezes a minor's API at its first beta or rc (api/1.17.0-rc01.txt): the last such file of the pinned minor.
  const { version, minor } = pinnedWebkit();
  const listing = await fetch(ANDROIDX_API_DIR);
  if (!listing.ok) throw new Error(`${ANDROIDX_API_DIR}: ${listing.status}`);
  const file = ((await listing.json()) as { name: string; download_url: string }[])
    .filter((f) => f.name.startsWith(`${minor}.0-`))
    .sort((a, b) => a.name.localeCompare(b.name))
    .at(-1);
  if (!file) throw new Error(`no androidx.webkit API file for ${minor} in ${ANDROIDX_API_DIR}`);
  writeFileSync(
    new URL('androidx-webkit-api.txt', inputs),
    `// androidx.webkit ${version}: webkit/webkit/api/${file.name}\n${await (await fetch(file.download_url)).text()}`
  );
}

type Availability = { since?: string; deprecated?: string };

const doc = ({ since, deprecated }: Availability, text = '') => {
  const lines = [
    text,
    since && `@since ${since}`,
    deprecated && `@deprecated ${deprecated}`,
  ].filter(Boolean);
  if (lines.length > 1) return `/**\n * ${lines.join('\n * ')}\n */\n`;
  return lines.length ? `/** ${lines[0]} */\n` : '';
};

function members(...parts: Record<string, string>[]) {
  const all: Record<string, string> = {};
  for (const part of parts) for (const [key, member] of Object.entries(part)) all[key] ??= member;
  return Object.values(all).join('\n');
}

const object = (entries: Record<string, string | number>) =>
  `{\n${Object.entries(entries)
    .map(([key, value]) => `${key}: ${value},`)
    .join('\n')}\n}`;

const lowerFirst = (name: string) => name.replace(/^[A-Z]/, (c) => c.toLowerCase());

const repoFile = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const KOTLIN_SETTINGS = 'android/src/main/java/expo/modules/minimalwebview/PlatformSettings.kt';

function assertSameNames(
  names: readonly string[],
  file: string,
  read: (source: string) => string[]
) {
  const ours = [...names].sort().join(', ');
  const theirs = read(repoFile(file)).join(', ');
  if (ours !== theirs)
    throw new Error(`${file} handles ${theirs}, gen-platform-types.mts expects ${ours}`);
}

/** A C expression over integers, as JavaScript. The inputs are the vendored SDK extracts, not user data. */
const evaluate = (expression: string) => runInNewContext(`(${expression})`) as number;

/** A declaration's availability from its API_AVAILABLE / API_DEPRECATED / API_UNAVAILABLE macros, or null when it's not on iOS. */
function iosAvailability(macros: string): Availability | null {
  if ((macros.match(/API_UNAVAILABLE\(([^)]*)\)/g) ?? []).some((m) => /\bios\b/.test(m)))
    return null;
  const available = macros.match(/API_(AVAILABLE|DEPRECATED|DEPRECATED_WITH_REPLACEMENT)\((.*)\)/);
  if (!available) return {};
  const ios = available[2].match(/\bios\((\d+(?:\.\d+)?)/);
  if (!ios) return null;
  const since = `iOS ${ios[1]}`;
  if (available[1] === 'AVAILABLE') return { since };
  const message = available[2].match(/"([^"]*)"/)?.[1];
  return { since, deprecated: available[1] === 'DEPRECATED' ? message : `use ${message}` };
}

const STRUCTS: Record<string, string> = {
  UIEdgeInsets: '{ top: number; left: number; bottom: number; right: number }',
  CGPoint: '{ x: number; y: number }',
  CGSize: '{ width: number; height: number }',
  CGRect: '{ x: number; y: number; width: number; height: number }',
};
const STRUCT_DOCS: Record<string, string> = {
  UIEdgeInsets: 'Insets from each edge, in points, as in `scrollView.contentInset`.',
  CGPoint: 'A point, as in `scrollView.contentOffset`.',
  CGSize: 'A size, as in `scrollView.contentSize`.',
  CGRect: 'A rectangle, for a setting under `other` or a `call` argument.',
};
const OBJECTS: Record<string, string> = {
  NSString: 'string',
  NSURL: 'string',
  NSNumber: 'number',
  UIColor: 'string',
  WKWebsiteDataStore: "'default' | 'nonPersistent'",
};

/** An Objective-C property type as TypeScript, or null for one the settings channel can't carry (an object). */
function tsType(type: string) {
  const pointer = type.match(/^(\w+)\s*\*$/);
  if (pointer) return OBJECTS[pointer[1]] ?? null;
  if (/[*<]|^id\b/.test(type)) return null;
  if (type === 'BOOL') return 'boolean';
  return type in STRUCTS ? type : 'number';
}

function iosKeys(text: string, cls: string, enums: Set<string>) {
  const keys: Record<string, string> = {};
  for (const [block] of text.matchAll(new RegExp(`^@interface ${cls}\\b[^]*?^@end`, 'gm'))) {
    for (const [, attributes, type, name, macros = ''] of block.matchAll(
      // A macro's message may hold a `;`.
      /^@property\s*\(([^)]*)\)\s*([^;]*?)\s*\b(\w+)\s*((?:API_|NS_SWIFT_NAME|NS_REFINED)(?:"[^"]*"|[^;"])*)?;/gm
    )) {
      const list = attributes.split(',').map((a) => a.trim());
      if (list.includes('readonly') || list.includes('class')) continue;
      const ts = tsType(type.trim());
      const availability = iosAvailability(macros);
      if (!ts || !availability) continue;
      const nullable = list.includes('nullable') || list.includes('null_resettable');
      const constants = constantsName(type.trim());
      const note = enums.has(constants) ? `A {@link IOSConstants.${constants}}.` : '';
      keys[name] = `${doc(availability, note)}${name}?: ${ts}${nullable ? ' | null' : ''};`;
    }
  }
  return keys;
}

function enumValues(body: string) {
  const values: Record<string, number> = {};
  const unbounded: string[] = [];
  let last = -1;
  for (const line of body.split('\n')) {
    if (line.includes('API_DEPRECATED')) continue;
    const member = line
      .replace(/\/\/.*|(API_\w+|NS_SWIFT_NAME)\((?:[^()]|\([^()]*\))*\)/g, '')
      .match(/^\s*(\w+)\s*(?:=\s*(.+?))?\s*,?\s*$/);
    if (!member) continue;
    const expression = member[2]?.replace(/\b[A-Za-z_]\w*\b/g, (id) => String(values[id] ?? id));
    if (expression === 'NSUIntegerMax') unbounded.push(member[1]);
    else {
      last = expression ? evaluate(expression) : last + 1;
      values[member[1]] = last;
    }
  }
  const all = Object.values(values).reduce((a, b) => a | b, 0);
  for (const name of unbounded) values[name] = all;
  return values;
}

const constantsName = (type: string) => type.replace(/^(WK|UIScrollView)/, '');

function iosEnums(text: string) {
  const enums: Record<string, string> = {};
  for (const [, name, body, macros] of text.matchAll(
    /typedef NS_(?:ENUM|OPTIONS)\s*\(\s*\w+\s*,\s*(\w+)\s*\)\s*\{([^}]*)\}([^;]*);/g
  )) {
    const availability = iosAvailability(macros);
    if (!availability) continue;
    const values = enumValues(body);
    const names = Object.keys(values);
    let prefix = [name, ...names].reduce((p, m) => {
      let i = 0;
      while (i < p.length && p[i] === m[i]) i++;
      return p.slice(0, i);
    });
    while (names.some((m) => /[a-z0-9]/.test(m[prefix.length] ?? ''))) prefix = prefix.slice(0, -1);
    const key = `${doc({ deprecated: availability.deprecated }, '@enum')}${constantsName(name)}`;
    enums[key] = object(
      Object.fromEntries(
        Object.entries(values).map(([m, v]) => [
          m.slice(prefix.length).replace(/^[A-Z]/, (c) => c.toLowerCase()),
          v,
        ])
      )
    );
  }
  return enums;
}

/** The `WKWebsiteDataType*` string constants (their value is their name) as `{ cookies: 'WKWebsiteDataTypeCookies' }`. */
function websiteDataTypes(text: string) {
  const entries = [
    ...text.matchAll(/^WK_EXTERN NSString \* const WKWebsiteDataType(\w+)\s*([^;]*);/gm),
  ]
    .filter(([, , macros]) => iosAvailability(macros) && !macros.includes('DEPRECATED'))
    .map(([, name]) => [lowerFirst(name), `'WKWebsiteDataType${name}'`]);
  return Object.fromEntries(entries) as Record<string, string>;
}

const COMPLETIONS = ['void', 'value', 'valueError', 'error', 'number'] as const;
type Completion = (typeof COMPLETIONS)[number];

/** A block's parameter list (`NSData * _Nullable data, NSError * _Nullable error`) as a shape, or null for none. */
function completionShape(params: string, integerEnums: Set<string>): Completion | null {
  const list = params
    .split(',')
    .map((p) =>
      p.replace(/\b(_Nullable|_Nonnull|nullable|nonnull|WK_NULLABLE_RESULT)\b/g, '').trim()
    )
    .filter((p) => p && p !== 'void');
  const isObject = (p: string) => p.includes('*') || /^id\b/.test(p);
  const error = (p: string) => /^NSError\s*\*/.test(p);
  const integer = (p: string) =>
    /^(NSInteger|NSUInteger)\b/.test(p) || integerEnums.has(p.split(/\s/)[0]);
  const [first, second] = list;
  if (!first) return 'void';
  if (list.length === 1)
    return error(first) ? 'error' : isObject(first) ? 'value' : integer(first) ? 'number' : null;
  return list.length === 2 && isObject(first) && error(second) ? 'valueError' : null;
}

function interfaceCompletions(block: string, integerEnums: Set<string>) {
  const shapes: [string, Completion][] = [];
  for (const [, declaration] of block.matchAll(/^- \(void\)(.*);/gm)) {
    const selector = [...declaration.matchAll(/(\w+):\(/g)]
      .map(([, label]) => `${label}:`)
      .join('');
    const last = [...declaration.matchAll(/\(\^[^)]*\)\s*\(([^)]*)\)\)\s*\w+/g)].at(-1);
    const params =
      last && !/\w+:\(/.test(declaration.slice(last.index + last[0].length)) ? last[1] : undefined;
    const shape = params === undefined ? null : completionShape(params, integerEnums);
    if (shape && iosAvailability(declaration)) shapes.push([selector, shape]);
  }
  return shapes;
}

function iosCompletions(text: string) {
  const integerEnums = new Set(
    [...text.matchAll(/typedef NS_ENUM\s*\(\s*NSU?Integer\s*,\s*(\w+)\s*\)/g)].map(
      ([, name]) => name
    )
  );
  const shapes: Record<string, Completion> = {};
  for (const [root, cls] of Object.entries(COMPLETION_ROOTS)) {
    for (const [block] of text.matchAll(new RegExp(`^@interface ${cls}\\b[^]*?^@end`, 'gm'))) {
      for (const [selector, shape] of interfaceCompletions(block, integerEnums))
        shapes[`${root}.${selector}`] = shape;
    }
  }
  return shapes;
}

const DESCRIPTORS: Record<string, string> = {
  Z: 'boolean',
  I: 'number',
  J: 'number',
  F: 'number',
  D: 'number',
  'Ljava/lang/String;': 'string | null',
};
const JAVA_TYPES: Record<string, string> = {
  boolean: 'boolean',
  int: 'number',
  long: 'number',
  float: 'number',
  double: 'number',
  String: 'string | null',
};
const owned = repoFile(KOTLIN_SETTINGS).match(/\bval OWNED = setOf\(([^)]*)\)/)?.[1];
if (!owned) throw new Error(`${KOTLIN_SETTINGS} has no \`val OWNED = setOf(...)\``);
const OWNED_KEYS = new Set([...owned.matchAll(/"set(\w+)"/g)].map(([, name]) => lowerFirst(name)));

function androidKeys(xml: string, cls: string, leading = '', text = '') {
  const block = classBlock(xml, cls);
  const pattern = new RegExp(
    `<method name="set(\\w+)\\(${leading}(Z|I|J|F|D|Ljava/lang/String;)\\)V"([^/]*)/>`,
    'g'
  );
  const keys: Record<string, string> = {};
  for (const [, name, descriptor, attributes] of block.matchAll(pattern)) {
    if (attributes.includes('removed=') || OWNED_KEYS.has(lowerFirst(name))) continue;
    const since = attributes.match(/since="(\d+)"/)?.[1] ?? '1';
    const deprecated = attributes.match(/deprecated="(\d+)"/)?.[1];
    keys[lowerFirst(name)] =
      `${doc({ since: `Android API ${since}`, deprecated: deprecated && `since API ${deprecated}` }, text)}${lowerFirst(name)}?: ${DESCRIPTORS[descriptor]};`;
  }
  return keys;
}

function androidxKeys(api: string, cls: string, root: string) {
  const block = api.match(new RegExp(`public class ${cls} \\{[^]*?\\n  \\}`))?.[0] ?? '';
  const pattern = new RegExp(
    `method ((?:@\\S+(?:\\([^)]*\\))? )*)public static void set(\\w+)\\(android\\.webkit\\.${root}, (boolean|int|long|float|double|String)\\);`,
    'g'
  );
  const keys: Record<string, string> = {};
  for (const [, annotations, name, type] of block.matchAll(pattern)) {
    const feature = annotations.match(
      /@RequiresFeature\(name=(?:androidx\.webkit\.WebViewFeature\.)?"?(\w+)/
    )?.[1];
    const deprecated = annotations.includes('@Deprecated') ? 'in androidx.webkit' : undefined;
    const text = `\`${cls}\`${feature ? `, WebView feature \`${feature}\`` : ''}`;
    keys[lowerFirst(name)] =
      `${doc({ deprecated }, text)}${lowerFirst(name)}?: ${JAVA_TYPES[type]};`;
  }
  return keys;
}

function javaConstants(text: string, cls: string) {
  const block =
    text.match(
      new RegExp(`(?:class android\\.webkit\\.${cls} |public class ${cls} \\{)[^]*?\\n {0,2}\\}`)
    )?.[0] ?? '';
  const fields = [
    ...block.matchAll(
      /^\s*(?:field )?((?:@\S+ )*)public static final (?:int|long|String|java\.lang\.String) (\w+) = (.+?);/gm
    ),
  ];
  return fields
    .map(
      ([, annotations, name, value]) =>
        `${annotations.includes('@Deprecated') ? '/** @deprecated */\n' : ''}${name}: ${value},`
    )
    .join('\n');
}

function swiftCompletions(shapes: Record<string, Completion>) {
  return `// Generated by .github/scripts/gen-platform-types.mts from .github/scripts/platform-headers/. Do not edit.
// Regenerate with \`npm run gen:platform-types\`.

/// The completion-handler shape of each WebKit method \`PlatformSettings.call\` reaches, by \`root.selector\`, for MRWInvoke.
let platformCompletions: [String: String] = [
${Object.entries(shapes)
  .map(([selector, shape]) => `  "${selector}": "${shape}",`)
  .join('\n')}
]
`;
}

async function generate() {
  assertSameNames(Object.keys(OBJECTS), 'ios/PlatformSettings.swift', coercedObjects);
  assertSameNames(COMPLETIONS, 'ios/MRWInvoke.m', completionShapes);
  // Sorted, so IOSConstants' member order is the same on every filesystem.
  const ios = readdirSync(inputs)
    .filter((f) => f.endsWith('.h'))
    .sort()
    .map(read)
    .join('\n');
  const xml = read('android-webkit-api.xml');
  const androidx = read('androidx-webkit-api.txt');
  const constants = read('android-webkit-constants.txt');
  const enums = iosEnums(ios);
  const enumNames = new Set(Object.keys(enums).map((key) => key.split('\n').at(-1)!));
  const output = `// Generated by .github/scripts/gen-platform-types.mts from .github/scripts/platform-headers/. Do not edit.

${Object.entries(STRUCTS)
  .map(
    ([name, shape]) =>
      `/**\n * ${STRUCT_DOCS[name]}\n * @group Platform settings\n * @ios\n */\nexport type ${name} = ${shape};`
  )
  .join('\n\n')}

/**
 * The iOS settings keys, by root. They are the writable WebKit and UIScrollView properties whose type is a
 * \`SettingValue\`.
 * @group Platform settings
 * @ios
 */
export type IOSSettingKeys = ${object(
    Object.fromEntries(
      Object.entries(IOS_ROOTS).map(([root, cls]) => [
        `/** \`${cls}\` */\n${root}`,
        `{\n${members(iosKeys(ios, cls, enumNames))}\n}`,
      ])
    )
  )};

/**
 * The Android settings keys, by root. They are the one-argument setters of \`WebSettings\` and \`WebView\`,
 * \`CookieManager\`'s \`(WebView, value)\` setter, the \`WebSettingsCompat\` and \`WebViewCompat\` statics, and the scroll
 * setters that \`WebView\` inherits from \`View\`.
 * @group Platform settings
 * @android
 */
export type AndroidSettingKeys = ${object({
    '/** `WebSettings`, then `WebSettingsCompat` */\nsettings': `{\n${members(
      androidKeys(xml, 'android/webkit/WebSettings'),
      androidxKeys(androidx, 'WebSettingsCompat', 'WebSettings')
    )}\n}`,
    "/** `WebView`, then `WebViewCompat`, then `CookieManager`, then `View`'s scroll setters */\nwebView": `{\n${members(
      androidKeys(xml, 'android/webkit/WebView'),
      androidxKeys(androidx, 'WebViewCompat', 'WebView'),
      androidKeys(
        xml,
        'android/webkit/CookieManager',
        'Landroid/webkit/WebView;',
        '`CookieManager`'
      ),
      androidKeys(xml, 'android/view/View', '', '`View`')
    )}\n}`,
  })};

/**
 * WebKit's and UIScrollView's enums and option sets by raw value, for the iOS keys that take one. For example:
 * \`configuration: { dataDetectorTypes: IOSConstants.DataDetectorTypes.link }\`.
 *
 * An option set's \`all\` is the OR of its listed bits.
 *
 * These three are for \`call\`, not for keys:
 *
 * - \`WebsiteDataType\`: the data type names the \`websiteDataStore\` methods take.
 * - \`WebViewDataType\`: the option set \`webView.fetchDataOfTypes:\` takes.
 * - \`CookiePolicy\`: the value \`httpCookieStore.setCookiePolicy:completionHandler:\` takes.
 * @group Platform settings
 * @ios
 * @namespace
 * @hideGroups
 */
export const IOSConstants = ${object({
    ...enums,
    '/** @enum */\nWebsiteDataType': object(websiteDataTypes(ios)),
  })} as const;

/**
 * The \`WebSettings\`, \`WebView\`, \`WebSettingsCompat\` and \`WebViewCompat\` constants. For example:
 * \`settings: { cacheMode: AndroidConstants.WebSettings.LOAD_NO_CACHE }\`.
 * @group Platform settings
 * @android
 * @namespace
 * @hideGroups
 */
export const AndroidConstants = ${object({
    '/** @enum */\nWebSettings': `{\n${javaConstants(constants, 'WebSettings')}\n}`,
    '/** @enum */\nWebView': `{\n${javaConstants(constants, 'WebView')}\n}`,
    '/** @enum */\nWebSettingsCompat': `{\n${javaConstants(androidx, 'WebSettingsCompat')}\n}`,
    '/** @enum */\nWebViewCompat': `{\n${javaConstants(androidx, 'WebViewCompat')}\n}`,
  })} as const;
`;
  const { ignorePatterns, ...options } = oxfmtConfig;
  const formatted = await format(fileURLToPath(target), output, options);
  if (formatted.errors.length) throw new Error(formatted.errors.map((e) => e.message).join('\n'));
  return {
    ts: formatted.code,
    swift: swiftCompletions(iosCompletions(ios)),
  };
}

if (process.argv.includes('--import')) await importInputs();
const output = await generate();
if (process.argv.includes('--check')) {
  const vendored = read('androidx-webkit-api.txt').match(/^\/\/ androidx\.webkit (\S+):/)?.[1];
  const { version } = pinnedWebkit();
  if (vendored !== version)
    throw new Error(
      `platform-headers/androidx-webkit-api.txt is androidx.webkit ${vendored}, android/build.gradle pins ${version}: run pnpm run gen:platform-types --import`
    );
  if (
    readFileSync(target, 'utf8') !== output.ts ||
    readFileSync(swiftTarget, 'utf8') !== output.swift
  )
    throw new Error(
      'platform.generated.ts or PlatformCompletions.generated.swift is stale: run pnpm run gen:platform-types'
    );
} else {
  writeFileSync(target, output.ts);
  writeFileSync(swiftTarget, output.swift);
}
