/**
 * @groupDescription WebView
 * The component, its props and its ref.
 * @groupDescription Navigation
 * The navigation state, and the rules that decide what each navigation does.
 * @groupDescription Events
 * What `onError`, `onProcessGone` and `onFullscreenChange` receive.
 * @groupDescription Bridge
 * Calls and events between React Native and the page's `window.nativeBridge`.
 * @groupDescription Scripts
 * Scripts for `injectedScripts`, which run at document start.
 * @groupDescription Page requests
 * File pickers, permission prompts and downloads the page starts.
 * @groupDescription Native hooks
 * What native hooks send to `onHookEvent`.
 * @groupDescription Platform settings
 * WebKit and Android WebView properties, set by name through the `ios` and `android` props.
 * @document ../guides/examples.md
 * @document ../guides/migrating-from-react-native-webview.md
 * @packageDocumentation
 */
export { WebView } from './WebView';
export { createWebViewRef, useWebViewState } from './refStore';
export { createBridge } from './bridge/createBridge';
export { reactNativeWebViewMessages } from './reactNativeWebViewMessages';
export { AndroidConstants, IOSConstants } from './platform.generated';
export type {
  AndroidSettingKeys,
  CGPoint,
  CGRect,
  CGSize,
  IOSSettingKeys,
  UIEdgeInsets,
} from './platform.generated';
export type { BridgeErrorCode } from './bridge/protocol';
export * from './types';
