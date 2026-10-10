import type { WebViewExtension } from '../types';

/**
 * HTML5 fullscreen video on Android (system bars hide, back exits). iOS has it built in.
 * `onChange(active)` reports entering and leaving fullscreen on Android.
 */
export const fullscreenVideo = (options: { onChange?: (active: boolean) => void } = {}): WebViewExtension => ({
  native: { name: 'fullscreenVideo' },
  onEvent: (event, payload) => {
    if (event === 'fullscreen') options.onChange?.(payload['active'] === true);
  },
});
