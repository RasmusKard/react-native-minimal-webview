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
