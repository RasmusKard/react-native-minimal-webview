import type { AndroidSettings, IOSSettings } from './types';

/**
 * Defaults taken from react-native-webview, so that an app migrated from it behaves as before. Each is a plain boolean
 * an app sets back through `ios` or `android`, not a design decision of this package.
 */
export const REACT_NATIVE_WEBVIEW_DEFAULTS = {
  ios: { scrollView: { directionalLockEnabled: true } },
  android: {
    settings: { useWideViewPort: true, loadWithOverviewMode: true },
    webView: { acceptThirdPartyCookies: true },
  },
} satisfies { ios: IOSSettings; android: AndroidSettings };
