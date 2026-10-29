import type { Extension } from '../src/extension';

export const basicAuthCredential: Extension = {
  key: 'minimal-rn-webview-extensions.basicAuthCredential',
  props: ['basicAuthCredential'],
  options: (props) => props.basicAuthCredential,
};
