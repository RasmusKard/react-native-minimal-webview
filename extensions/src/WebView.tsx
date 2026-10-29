import { WebView as CoreWebView, type WebViewProps as CoreWebViewProps } from 'minimal-rn-webview';
import { Platform } from 'react-native';

import { androidLayerType } from '../androidLayerType';
import { basicAuthCredential } from '../basicAuthCredential';
import { dialogs } from '../dialogs';
import { hideKeyboardAccessoryView } from '../hideKeyboardAccessoryView';
import { menuItems } from '../menuItems';
import { nestedScrollEnabled } from '../nestedScrollEnabled';
import { onScroll } from '../onScroll';
import type { Extension } from './extension';
import type { WebViewProps } from './types';

const EXTENSIONS: readonly Extension[] = [
  basicAuthCredential,
  dialogs,
  menuItems,
  onScroll,
  hideKeyboardAccessoryView,
  nestedScrollEnabled,
  androidLayerType,
];
const OWN = new Set<string>(EXTENSIONS.flatMap((extension) => extension.props));
/** Each event a prop takes, by its full name. */
const EVENTS = new Map<string, NonNullable<Extension['events']>[string]>(
  EXTENSIONS.flatMap(({ key, events = {} }) =>
    Object.entries(events).map(([name, route]) => [`${key}.${name}`, route] as const)
  )
);

/**
 * The core's `WebView` with the {@link ExtensionProps}.
 *
 * Your own `hookOptions` and `onHookEvent` still work: your keys stay beside this package's, and `onHookEvent` gets
 * every event no prop takes. With none of these props set, the core gets your `hookOptions` as they are. The core's
 * statics, such as `WebView.android`, stay on the core's `WebView`.
 * @group WebView
 */
export function WebView(props: WebViewProps) {
  const core: CoreWebViewProps = Object.fromEntries(
    Object.entries(props).filter(([name]) => !OWN.has(name))
  ) as CoreWebViewProps;
  return <CoreWebView {...core} {...hooks(props)} />;
}

/** The core's `hookOptions` with the keys of the props that are set, and an `onHookEvent` that calls them. */
function hooks(props: WebViewProps): Pick<CoreWebViewProps, 'hookOptions' | 'onHookEvent'> {
  const on = EXTENSIONS.filter(({ platform }) => !platform || platform === Platform.OS)
    .map(({ key, options }) => [key, options(props)] as const)
    .filter(([, value]) => value !== undefined);
  return {
    hookOptions: on.length ? { ...props.hookOptions, ...Object.fromEntries(on) } : props.hookOptions,
    onHookEvent: (event, signal) => {
      const route = EVENTS.get(event.name);
      const callback = route && (props[route.prop] as ((...args: unknown[]) => unknown) | undefined);
      // Only an ask has a signal: an emit calls a react-native-webview callback with its event alone.
      const args = signal ? [signal] : [];
      return callback
        ? callback(route.arg(event.payload), ...args)
        : props.onHookEvent?.(event, signal);
    },
  };
}
