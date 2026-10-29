import type { ExtensionProps, WebViewProps } from './types';

type Callback = {
  [K in keyof ExtensionProps]-?: NonNullable<ExtensionProps[K]> extends (...args: never[]) => unknown ? K : never;
}[keyof ExtensionProps];

/** One extension's JS side: its hook key, the props it takes from the core's, and where its events go. */
export type Extension = {
  /** The hook key, the same in the extension's Swift and Kotlin. */
  key: string;
  /** The only platform that registers the hook, or undefined for both. */
  platform?: 'ios' | 'android';
  /** The props that are the extension's, which the core's WebView doesn't get. */
  props: readonly (keyof ExtensionProps)[];
  /** The hook's `hookOptions` value for these props; undefined leaves the key out. */
  options: (props: WebViewProps) => unknown;
  /** The callback prop each of the hook's events goes to, by event name, and its argument. */
  events?: Record<string, { prop: Callback; arg: (payload: Record<string, unknown>) => unknown }>;
};

/** react-native-webview's callbacks get a synthetic event, of which only `nativeEvent` is filled in. */
export const nativeEvent = (payload: unknown) => ({ nativeEvent: payload });
