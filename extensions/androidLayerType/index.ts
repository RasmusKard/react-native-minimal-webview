import type { Extension } from '../src/extension';

export const androidLayerType: Extension = {
  key: 'minimal-rn-webview-extensions.androidLayerType',
  platform: 'android',
  props: ['androidLayerType'],
  options: (props) => props.androidLayerType,
};
