import type { HookExtension } from 'react-native-minimal-webview';
import { Platform } from 'react-native';

/**
 * An item of the text selection menu, for {@link menuItems}.
 * @group Values
 */
export type MenuItem = {
  /** What the menu shows. */
  label: string;
  /** What `onSelect` gets when it is chosen. */
  key: string;
};

/**
 * A system item of the text selection menu, by react-native-webview's name, for {@link menuItems}.
 * @ios
 * @group Values
 */
export type SuppressMenuItem =
  | 'cut'
  | 'copy'
  | 'paste'
  | 'replace'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'select'
  | 'selectAll'
  | 'translate'
  | 'lookup'
  | 'share';

/**
 * An item chosen from the text selection menu, for {@link menuItems}.
 * @group Events
 */
export type CustomMenuSelectionEvent = {
  nativeEvent: {
    label: string;
    key: string;
    /** The main frame's selected text (`window.getSelection()`). */
    selectedText: string;
  };
};

/**
 * The text selection menu: react-native-webview's `menuItems`, `suppressMenuItems` and `onCustomMenuSelection`.
 * `items` replace the system's items, `onSelect` gets the one chosen, and on iOS `suppress` hides system items. Null
 * when neither is set on this platform (`suppress` alone on Android).
 *
 * Turn it on when the WebView is created. Once it has, a change, switching it off included, applies to the next menu.
 * Its hook makes the WebView from a class of its own, so when another hook's `webViewClass` or `webViewFactory`,
 * registered earlier, makes it instead, there is no menu and the core warns. On iOS the items are added to WebKit's own
 * selection menu.
 * @group Extensions
 */
export function menuItems(menu: {
  items?: readonly MenuItem[];
  /** @ios */
  suppress?: readonly SuppressMenuItem[];
  onSelect?: (event: CustomMenuSelectionEvent) => void;
}): HookExtension | null {
  const { items, suppress, onSelect } = menu;
  if (!items && !(Platform.OS === 'ios' && suppress)) return null;
  return {
    key: '@react-native-minimal-webview/extensions.menuItems',
    options: { items, suppress },
    onEvent: ({ payload }) =>
      onSelect?.({ nativeEvent: payload as CustomMenuSelectionEvent['nativeEvent'] }),
  };
}
