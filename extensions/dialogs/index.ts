import type { Extension } from '../src/extension';

export const dialogs: Extension = {
  key: 'minimal-rn-webview-extensions.dialogs',
  props: ['onDialog'],
  options: (props) => (props.onDialog ? true : undefined),
  events: {
    alert: { prop: 'onDialog', arg: (payload) => ({ ...payload, type: 'alert' }) },
    confirm: { prop: 'onDialog', arg: (payload) => ({ ...payload, type: 'confirm' }) },
    prompt: { prop: 'onDialog', arg: (payload) => ({ ...payload, type: 'prompt' }) },
  },
};
