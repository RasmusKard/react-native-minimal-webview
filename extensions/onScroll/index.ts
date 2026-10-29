import { type Extension, nativeEvent } from '../src/extension';

export const onScroll: Extension = {
  key: 'minimal-rn-webview-extensions.onScroll',
  props: ['onScroll'],
  options: (props) => (props.onScroll ? true : undefined),
  events: { scroll: { prop: 'onScroll', arg: nativeEvent } },
};
