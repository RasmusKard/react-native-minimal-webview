import type { NavigationRule } from './types';

const freeze = <T extends object>(value: T): T => {
  Object.values(value).forEach((field) => typeof field === 'object' && freeze(field as object));
  return Object.freeze(value);
};

/**
 * The rules `navigationRules` has when it is unset: `file:` is blocked, http(s) loads in place, and any other scheme
 * opens externally from the main frame when a user gesture started it ({@link NavigationRule.userInitiated}).
 *
 * Anything else, an iframe's or one without a gesture, is blocked, so a page opens an app only right after the user's
 * tap, click or key press, as each platform counts them. On iOS that leaves out the redirect after a form POST, such
 * as an OAuth `myapp://callback`: an `external` rule for its scheme before these opens it.
 *
 * Frozen; spread it after your own rules to keep it.
 * @see [Navigation rules example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#navigation-rules)
 * @group Navigation
 */
export const defaultNavigationRules: readonly NavigationRule[] = freeze<NavigationRule[]>([
  { scheme: ['file'], action: 'block' },
  { scheme: ['http', 'https'], action: 'allow' },
  { mainFrame: true, userInitiated: true, action: 'external' },
]);

const RULE_FIELDS = new Map(
  Object.entries({
    scheme: 'list',
    host: 'list',
    path: 'list',
    query: 'list',
    mainFrame: 'flag',
    newWindow: 'flag',
    userInitiated: 'flag',
    action: 'action',
  } satisfies {
    [K in keyof NavigationRule]-?: NonNullable<NavigationRule[K]> extends readonly string[]
      ? 'list'
      : NonNullable<NavigationRule[K]> extends boolean
        ? 'flag'
        : 'action';
  })
);
const ACTIONS: unknown[] = Object.keys({
  allow: 0,
  block: 0,
  external: 0,
  ask: 0,
} satisfies Record<NavigationRule['action'], 0>);

const shown = (value: unknown) => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return typeof value === 'bigint' ? String(value) : Object.prototype.toString.call(value);
  }
};

const FIELD_KINDS = {
  list: {
    takes: 'an array of strings',
    ok: (value: unknown) =>
      Array.isArray(value) && value.every((entry) => typeof entry === 'string'),
  },
  flag: { takes: 'true or false', ok: (value: unknown) => typeof value === 'boolean' },
  action: { takes: `one of ${shown(ACTIONS)}`, ok: (value: unknown) => ACTIONS.includes(value) },
};

function ruleProblem(rule: unknown) {
  if (typeof rule !== 'object' || rule === null) return `must be an object, not ${shown(rule)}`;
  for (const [key, value] of Object.entries({ action: undefined, ...rule })) {
    const kind = RULE_FIELDS.get(key);
    if (!kind) return `unknown key ${shown(key)}`;
    if ((value !== undefined || kind === 'action') && !FIELD_KINDS[kind].ok(value))
      return `${key} must be ${FIELD_KINDS[kind].takes}, not ${shown(value)}`;
  }
  return undefined;
}

export function checkNavigationRules(given: unknown): {
  checked: NavigationRule[];
  warnings: string[];
} {
  if (!Array.isArray(given))
    return {
      checked: [],
      warnings: [`navigationRules: must be an array, not ${shown(given)}; treated as []`],
    };
  // Array.from, not map: map skips a sparse array's holes, which would reach native unchecked.
  const problems = Array.from(given, ruleProblem);
  return {
    checked: (problems.some(Boolean)
      ? Array.from(given, (rule: unknown, i) => (problems[i] ? { action: 'block' } : rule))
      : given) as NavigationRule[],
    warnings: problems.flatMap((problem, i) =>
      problem
        ? [`navigationRules[${i}]: ${problem}; it blocks every navigation that reaches it`]
        : []
    ),
  };
}
