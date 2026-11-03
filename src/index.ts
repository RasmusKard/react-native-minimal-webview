/**
 * The WebView component, with navigation rules, a bridge to the page and native hooks.
 *
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
 * Turning native hooks on with the `extensions` prop, and what they send to each extension's `onEvent`.
 * @groupDescription Platform settings
 * WebKit and Android WebView properties, set by name through the `ios` and `android` props.
 * @module react-native-minimal-webview
 * @packageDocumentation
 */
export { WebView } from './WebView';
export { createWebViewRef, useWebViewState } from './refStore';
export { createBridge } from './bridge/createBridge';
export { defaultNavigationRules } from './defaultNavigationRules';
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
export * from './types';
