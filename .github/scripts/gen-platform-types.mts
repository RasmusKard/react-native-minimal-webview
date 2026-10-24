// Generates src/platform.generated.ts: the iOS and Android settings keys as TypeScript types, and the platforms'
// constants, from the vendored SDK extracts in platform-headers/. Run after editing it:
// node .github/scripts/gen-platform-types.mts (`--check` fails if the output is stale).
// `--import` refreshes platform-headers/ from the installed Xcode and Android SDKs and the API file of the
// androidx.webkit version android/build.gradle pins: the explicit step after an SDK or androidx.webkit upgrade. It
// keeps only the declarations this script reads (the iOS doc comments are Apple's).
// The WK constant names are the header names with their common prefix stripped: an SDK rename renames a constant.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import prettier from 'prettier';

const inputs = new URL('platform-headers/', import.meta.url);
const target = new URL('../../src/platform.generated.ts', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, inputs), 'utf8');

const WEBKIT_HEADERS = [
  'WKWebViewConfiguration',
  'WKPreferences',
  'WKWebpagePreferences',
  'WKWebView',
  'WKDataDetectorTypes',
  'WKWebsiteDataRecord',
];
/** Root -> its Objective-C class. */
const IOS_ROOTS = {
  configuration: 'WKWebViewConfiguration',
  preferences: 'WKPreferences',
  webpagePreferences: 'WKWebpagePreferences',
  webView: 'WKWebView',
  scrollView: 'UIScrollView',
};
const ANDROID_CLASSES = ['WebSettings', 'WebView', 'CookieManager'];
/** One `<class>` block of api-versions.xml. */
const classBlock = (api: string, name: string) =>
  api.match(new RegExp(`\t<class name="${name}" [^]*?</class>\n`))?.[0] ?? '';
const ANDROIDX_API_DIR =
  'https://api.github.com/repos/androidx/androidx/contents/webkit/webkit/api?ref=androidx-main';

async function importInputs() {
  const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'])
    .toString()
    .trim();
  const sdkVersion = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'])
    .toString()
    .trim();
  const frameworks = `${sdk}/System/Library/Frameworks`;
  const headers = [
    ...WEBKIT_HEADERS.map((name) => `${frameworks}/WebKit.framework/Headers/${name}.h`),
    `${frameworks}/UIKit.framework/Headers/UIScrollView.h`,
  ];
  for (const path of headers) {
    // The preprocessor lines, the interfaces, their properties, the enum blocks and the string constants.
    let inEnum = false;
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => {
        if (inEnum) {
          inEnum = !line.startsWith('}');
          return true;
        }
        inEnum = /^typedef NS_(ENUM|OPTIONS)\b/.test(line);
        return (
          inEnum ||
          /^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b|^@(interface|end)\b|^@property\b|^WK_EXTERN NSString \* const /.test(
            line
          )
        );
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
  const [, version, minor] = readFileSync(
    new URL('../../android/build.gradle', import.meta.url),
    'utf8'
  ).match(/androidx\.webkit:webkit:((\d+\.\d+)\.\d+)/)!;
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

/** The members of `parts` (key -> member text) as one type body; the first declaration of a key wins. */
function members(...parts: Record<string, string>[]) {
  const all: Record<string, string> = {};
  for (const part of parts) for (const [key, member] of Object.entries(part)) all[key] ??= member;
  return Object.values(all).join('\n');
}

const object = (entries: Record<string, string | number>) =>
  `{\n${Object.entries(entries)
    .map(([key, value]) => `${key}: ${value},`)
    .join('\n')}\n}`;

/** A C expression over integers, as JavaScript. The inputs are the vendored SDK extracts, not user data. */
const evaluate = (expression: string) => runInNewContext(`(${expression})`) as number;

// iOS

const MACROS: Record<string, number> = {
  TARGET_OS_IPHONE: 1,
  TARGET_OS_IOS: 1,
  __IPHONE_OS_VERSION_MIN_REQUIRED: 999999,
};

/** A preprocessor condition for an iOS build; an unknown macro is 0. */
const condition = (expression: string) =>
  evaluate(
    expression
      .replace(/\/\/.*|\/\*.*?\*\//g, '')
      .replace(/__has_include\s*\([^)]*\)/g, '0')
      .replace(/defined\s*\(?\s*(\w+)\s*\)?/g, (_, macro: string) => (macro in MACROS ? '1' : '0'))
      .replace(/\b[A-Za-z_]\w*\b/g, (macro) => String(MACROS[macro] ?? 0))
  );

type Block = { parent: boolean; taken: boolean; active: boolean };

/** Applies one #if-family directive to the open blocks: each knows whether its parent and its current branch compile. */
function preprocess(blocks: Block[], kind: string, rest: string) {
  if (kind === 'endif') return void blocks.pop();
  const expression =
    ({ ifdef: `defined(${rest})`, ifndef: `!defined(${rest})` } as Record<string, string>)[kind] ??
    rest;
  const block = blocks.at(-1);
  if (block && (kind === 'else' || kind === 'elif')) {
    const taken = kind === 'else' || !!condition(expression);
    block.active = block.parent && !block.taken && taken;
    block.taken ||= taken;
  } else {
    const parent = block?.active ?? true;
    const taken = !!condition(expression);
    blocks.push({ parent, taken, active: parent && taken });
  }
}

/** The lines an iOS build compiles. */
function iosLines(header: string) {
  const blocks: Block[] = [];
  const lines: string[] = [];
  for (const line of header.split('\n')) {
    const directive = line.match(/^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b(.*)/);
    if (directive) preprocess(blocks, directive[1], directive[2]);
    else if (blocks.at(-1)?.active ?? true) lines.push(line);
  }
  return lines.join('\n');
}

/** A declaration's availability from its API_AVAILABLE / API_DEPRECATED / API_UNAVAILABLE macros, or null when it's not on iOS. */
function iosAvailability(macros: string): Availability | null {
  if ((macros.match(/API_UNAVAILABLE\(([^)]*)\)/g) ?? []).some((m) => /\bios\b/.test(m)))
    return null;
  const available = macros.match(/API_(AVAILABLE|DEPRECATED|DEPRECATED_WITH_REPLACEMENT)\((.*)\)/);
  if (!available) return {};
  const ios = available[2].match(/\bios\((\d+(?:\.\d+)?)/);
  if (!ios) return null;
  const message = available[2].match(/"([^"]*)"/)?.[1];
  const deprecated =
    available[1] === 'DEPRECATED'
      ? message
      : available[1] === 'DEPRECATED_WITH_REPLACEMENT'
        ? `use ${message}`
        : undefined;
  return { since: ios[1], deprecated };
}

const STRUCTS: Record<string, string> = {
  UIEdgeInsets: '{ top: number; left: number; bottom: number; right: number }',
  CGPoint: '{ x: number; y: number }',
  CGSize: '{ width: number; height: number }',
  CGRect: '{ x: number; y: number; width: number; height: number }',
};
/** The object types PlatformSettings.swift coerces from JSON. */
const OBJECTS: Record<string, string> = {
  NSString: 'string',
  NSURL: 'string',
  NSNumber: 'number',
  UIColor: 'string',
  WKWebsiteDataStore: "'default' | 'nonPersistent'",
};

/** An Objective-C property type as TypeScript, or null for one the settings channel can't carry (an object). */
function tsType(type: string) {
  const object = type.match(/^(\w+)\s*\*$/);
  if (object) return OBJECTS[object[1]] ?? null;
  if (/[*<]|^id\b/.test(type)) return null;
  if (type === 'BOOL') return 'boolean';
  return type in STRUCTS ? type : 'number'; // integers, floats, enums and option sets
}

/** The writable properties of `cls` the settings channel can carry: name -> TypeScript member. */
function iosKeys(text: string, cls: string) {
  const keys: Record<string, string> = {};
  for (const [block] of text.matchAll(new RegExp(`^@interface ${cls}\\b[^]*?^@end`, 'gm'))) {
    for (const [, attributes, type, name, macros = ''] of block.matchAll(
      /^@property\s*\(([^)]*)\)\s*([^;]*?)\s*\b(\w+)\s*((?:API_|NS_SWIFT_NAME|NS_REFINED)[^;]*)?;/gm
    )) {
      const list = attributes.split(',').map((a) => a.trim());
      if (list.includes('readonly') || list.includes('class')) continue;
      const ts = tsType(type.trim());
      const availability = iosAvailability(macros);
      if (!ts || !availability) continue;
      const nullable = list.includes('nullable') || list.includes('null_resettable');
      keys[name] = `${doc(availability)}${name}?: ${ts}${nullable ? ' | null' : ''};`;
    }
  }
  return keys;
}

/** The members of one NS_ENUM / NS_OPTIONS body, by name, deprecated ones left out. */
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
    // NSUIntegerMax (`All`) is not a JSON number: the OR of the other members, filled in below, has the same effect.
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

/** The NS_ENUM and NS_OPTIONS blocks as `Name: { member: value }` entries, members named without their common prefix. */
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
    const key = `${doc({ deprecated: availability.deprecated })}${name.replace(/^(WK|UIScrollView)/, '')}`;
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

// Android

/** JVM descriptors of the one-argument setter parameters the reflection channel takes. */
const DESCRIPTORS: Record<string, string> = {
  Z: 'boolean',
  I: 'number',
  J: 'number',
  F: 'number',
  D: 'number',
  'Ljava/lang/String;': 'string',
};
const JAVA_TYPES: Record<string, string> = {
  boolean: 'boolean',
  int: 'number',
  long: 'number',
  float: 'number',
  double: 'number',
  String: 'string',
};
const lowerFirst = (name: string) => name.replace(/^[A-Z]/, (c) => c.toLowerCase());

/** `set<Key>(<leading><simple>)V` methods of a class (`android/webkit/WebView`) from api-versions.xml: key -> TypeScript member. */
function androidKeys(xml: string, cls: string, leading = '', text = '') {
  const block = classBlock(xml, cls);
  const pattern = new RegExp(
    `<method name="set(\\w+)\\(${leading}(Z|I|J|F|D|Ljava/lang/String;)\\)V"([^/]*)/>`,
    'g'
  );
  const keys: Record<string, string> = {};
  for (const [, name, descriptor, attributes] of block.matchAll(pattern)) {
    if (attributes.includes('removed=')) continue;
    const since = attributes.match(/since="(\d+)"/)?.[1] ?? '1';
    const deprecated = attributes.match(/deprecated="(\d+)"/)?.[1];
    keys[lowerFirst(name)] =
      `${doc({ since, deprecated: deprecated && `since API ${deprecated}` }, text)}${lowerFirst(name)}?: ${DESCRIPTORS[descriptor]};`;
  }
  return keys;
}

/** The static `set<Key>(<root>, <simple>)` methods of an androidx.webkit compat class: key -> TypeScript member. */
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

/** `NAME: value,` lines of a class's public static final int, long and String fields in javap or metalava output. */
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

async function generate() {
  const ios = [...WEBKIT_HEADERS, 'UIScrollView']
    .map((name) => iosLines(read(`${name}.h`)))
    .join('\n');
  const xml = read('android-webkit-api.xml');
  const androidx = read('androidx-webkit-api.txt');
  const constants = read('android-webkit-constants.txt');
  const output = `// Generated by .github/scripts/gen-platform-types.mts from .github/scripts/platform-headers/. Do not edit.

/** The iOS structs the settings channel carries as objects. */
${Object.entries(STRUCTS)
  .map(([name, shape]) => `export type ${name} = ${shape};`)
  .join('\n')}

/**
 * The iOS settings keys by root: the writable WebKit and UIScrollView properties the settings channel can carry, from
 * the SDK headers. \`@since\` is the iOS version. A key a newer SDK adds works too: \`IOSSettings\` takes any key.
 */
export type IOSSettingKeys = ${object(
    Object.fromEntries(
      Object.entries(IOS_ROOTS).map(([root, cls]) => [
        `/** \`${cls}\` */\n${root}`,
        `{\n${members(iosKeys(ios, cls))}\n}`,
      ])
    )
  )};

/**
 * The Android settings keys by root: the one-argument \`WebSettings\`, \`WebView\` and \`CookieManager\` setters, then
 * \`WebSettingsCompat\`'s and \`WebViewCompat\`'s statics, then the scroll setters \`WebView\` inherits from \`View\`.
 * \`@since\` is the API level. A key a newer SDK or androidx.webkit adds works too: \`AndroidSettings\` takes any key.
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
 * WebKit's and UIScrollView's enums and option sets by raw value, for the iOS keys that take one:
 * \`configuration: { dataDetectorTypes: WK.DataDetectorTypes.link }\`. An option set's \`all\` is the OR of its listed
 * bits, not \`NSUIntegerMax\`, which JSON can't carry. \`WebsiteDataType\` has the data type names the \`websiteDataStore\`
 * methods take, for \`call\`; \`WebViewDataType\` is the option set \`webView.fetchDataOfTypes:\` takes.
 */
export const WK = ${object({
    ...iosEnums(ios),
    '/** `WKWebsiteDataStore` data types: `removeDataOfTypes:`, `fetchDataRecordsOfTypes:` */\nWebsiteDataType':
      object(websiteDataTypes(ios)),
  })} as const;

/** The \`WebSettings\`, \`WebView\`, \`WebSettingsCompat\` and \`WebViewCompat\` constants: \`settings: { cacheMode: Android.WebSettings.LOAD_NO_CACHE }\`. */
export const Android = ${object({
    WebSettings: `{\n${javaConstants(constants, 'WebSettings')}\n}`,
    WebView: `{\n${javaConstants(constants, 'WebView')}\n}`,
    WebSettingsCompat: `{\n${javaConstants(androidx, 'WebSettingsCompat')}\n}`,
    WebViewCompat: `{\n${javaConstants(androidx, 'WebViewCompat')}\n}`,
  })} as const;
`;
  const config = await prettier.resolveConfig(fileURLToPath(target));
  return await prettier.format(output, { ...config, parser: 'typescript' });
}

if (process.argv.includes('--import')) await importInputs();
const output = await generate();
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output)
    throw new Error('platform.generated.ts is stale: run npm run gen:platform-types');
} else {
  writeFileSync(target, output);
}
