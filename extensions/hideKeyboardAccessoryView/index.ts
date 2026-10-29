import type { Extension } from '../src/extension';

export const hideKeyboardAccessoryView: Extension = {
  key: '@minimal-rn-webview/extensions.hideKeyboardAccessoryView',
  platform: 'ios',
  props: ['hideKeyboardAccessoryView'],
  options: (props) => props.hideKeyboardAccessoryView || undefined,
};
