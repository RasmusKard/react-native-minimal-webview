import type { NavigationRule } from './types';

const freeze = <T extends object>(value: T): T => {
  Object.values(value).forEach((field) => typeof field === 'object' && freeze(field as object));
  return Object.freeze(value);
};

/**
 * The rules `navigationRules` has when it is unset: `file:` is blocked, http(s) loads in place, and any other scheme
 * opens externally from the main frame when a user gesture started it ({@link NavigationRule.userInitiated}).
 *
 * Anything else, a subframe's or one without a gesture, is blocked: a page that launches an app from a script or
 * timer, and on iOS also from a click handler or from a redirect after a form POST (an OAuth `myapp://callback`).
 *
 * Frozen; spread it after your own rules to keep it.
 * @group Navigation
 */
export const defaultNavigationRules: readonly NavigationRule[] = freeze<NavigationRule[]>([
  { scheme: ['file'], action: 'block' },
  { scheme: ['http', 'https'], action: 'allow' },
  { mainFrame: true, userInitiated: true, action: 'external' },
]);
