import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

/**
 * A layer type of Android's `View.setLayerType`, for {@link androidLayerType}.
 * @android
 * @group Values
 */
export type AndroidLayerType = 'none' | 'software' | 'hardware';

/**
 * Sets the WebView's layer type. The WebView that replaces one whose renderer crashed gets it too.
 *
 * Switched off, the layer type is `'none'` again.
 * @returns Null on iOS.
 * @android
 * @group Extensions
 */
export const androidLayerType = (type: AndroidLayerType): HookExtension | null =>
  Platform.OS === 'android'
    ? { key: '@react-native-minimal-webview/extensions.androidLayerType', options: type }
    : null;
