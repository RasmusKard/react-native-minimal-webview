import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

/**
 * Makes the pull-to-refresh spinner white, for dark pages: react-native-webview's `refreshControlLightMode`. Switched
 * off, it has its default color again. Null on Android.
 *
 * It applies also while `pullToRefresh` is off, for when it turns on.
 * @ios
 * @group Extensions
 */
export const refreshControlLightMode = (): HookExtension | null =>
  Platform.OS === 'ios'
    ? { key: '@react-native-minimal-webview/extensions.refreshControlLightMode' }
    : null;
