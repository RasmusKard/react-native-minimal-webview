import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

/**
 * Makes the pull-to-refresh spinner white, for dark pages.
 *
 * Switched off, the spinner has its default color again.
 * @returns Null on Android.
 * @ios
 * @group Extensions
 */
export const refreshControlLightMode = (): HookExtension | null =>
  Platform.OS === 'ios'
    ? { key: '@react-native-minimal-webview/extensions.refreshControlLightMode' }
    : null;
