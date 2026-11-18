import type { AndroidSettings, IOSSettings } from './types';

/**
 * react-native-webview's defaults, so that an app migrated from it behaves as before. An app sets any back through
 * `ios` or `android`.
 */
export const REACT_NATIVE_WEBVIEW_DEFAULTS = {
  ios: { scrollView: { directionalLockEnabled: true } },
  android: {
    settings: { useWideViewPort: true, loadWithOverviewMode: true },
    webView: { acceptThirdPartyCookies: true },
  },
} satisfies { ios: IOSSettings; android: AndroidSettings };
