import type { Extension } from '../src/extension';

export const nestedScrollEnabled: Extension = {
  key: '@minimal-rn-webview/extensions.nestedScrollEnabled',
  platform: 'android',
  props: ['nestedScrollEnabled'],
  options: (props) => props.nestedScrollEnabled || undefined,
};
