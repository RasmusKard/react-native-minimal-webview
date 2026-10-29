import { Platform } from 'react-native';

import { type Extension, nativeEvent } from '../src/extension';

export const menuItems: Extension = {
  key: 'minimal-rn-webview-extensions.menuItems',
  props: ['menuItems', 'suppressMenuItems', 'onCustomMenuSelection'],
  options: ({ menuItems: items, suppressMenuItems: suppress }) =>
    items || (Platform.OS === 'ios' && suppress) ? { items, suppress } : undefined,
  events: { selection: { prop: 'onCustomMenuSelection', arg: nativeEvent } },
};
