import { Platform } from 'react-native';
import type { HookEvent, HookExtension } from 'react-native-minimal-webview';

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
 * A system item of the text selection menu, for {@link menuItems}.
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
  label: string;
  key: string;
  /** The main frame's selected text (`window.getSelection()`). */
  selectedText: string;
};

/**
 * Sets the items of the text selection menu.
 *
 * `items` replace the system's items, and `onSelect` gets the one the user chooses. On iOS, `suppress` hides system
 * items.
 *
 * Turn it on when the WebView is created. After that, a change, switching it off included, applies to the next menu.
 *
 * Its hook makes the WebView from a class of its own. If another hook registered earlier makes the WebView with its
 * `webViewClass` or `webViewFactory`, there is no menu and the core warns.
 * @returns Null when `items` is unset and, on iOS, `suppress` is too.
 * @group Extensions
 */
export function menuItems(menu: {
  items?: readonly MenuItem[];
  /** @ios */
  suppress?: readonly SuppressMenuItem[];
  onSelect?: (event: CustomMenuSelectionEvent) => void;
}): HookExtension<HookEvent<'selection', CustomMenuSelectionEvent>> | null {
  const { items, suppress, onSelect } = menu;
  if (!items && !(Platform.OS === 'ios' && suppress)) return null;
  return {
    key: '@react-native-minimal-webview/extensions.menuItems',
    options: { items, suppress },
    onEvent: ({ payload }) => onSelect?.(payload),
  };
}
