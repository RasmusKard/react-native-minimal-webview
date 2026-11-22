import type { AndroidSettings, IOSSettings } from './types';

export const REACT_NATIVE_WEBVIEW_DEFAULTS = {
  ios: { scrollView: { directionalLockEnabled: true } },
  android: {
    settings: { useWideViewPort: true, loadWithOverviewMode: true },
    webView: { acceptThirdPartyCookies: true },
  },
} satisfies { ios: IOSSettings; android: AndroidSettings };
