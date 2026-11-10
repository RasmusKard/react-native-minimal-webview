import type { NavigationRule } from './types';

const freeze = <T extends object>(value: T): T => {
  Object.values(value).forEach((field) => typeof field === 'object' && freeze(field as object));
  return Object.freeze(value);
};

/**
 * The rules `navigationRules` has when it is unset: `file:` is blocked, http(s) loads in place, and any other scheme
 * opens externally from the main frame when a user gesture started it ({@link NavigationRule.userInitiated}).
 *
 * Anything else, a subframe's or one without a gesture, is blocked, so a page opens an app only right after the user's
 * tap, click or key press: on Android within the up to 5 s of user activation Chromium gives the page, on iOS through a
 * link activated within 1 s after a tap (or any link activation while VoiceOver or Switch Control runs). A page's
 * script or timer can't on its own, a link it clicks included; on iOS neither can a click handler's `location.href`, a
 * link activated from a hardware keyboard, or a redirect after a form POST (an OAuth `myapp://callback`).
 *
 * Frozen; spread it after your own rules to keep it.
 * @group Navigation
 */
export const defaultNavigationRules: readonly NavigationRule[] = freeze<NavigationRule[]>([
  { scheme: ['file'], action: 'block' },
  { scheme: ['http', 'https'], action: 'allow' },
  { mainFrame: true, userInitiated: true, action: 'external' },
]);
