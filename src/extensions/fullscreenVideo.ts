import type { WebViewExtension } from '../types';

/**
 * HTML5 fullscreen video on Android (system bars hide, back exits). iOS has it built in.
 * `onChange(active)` reports entering and leaving fullscreen on Android, e.g. to unlock the orientation with
 * expo-screen-orientation.
 */
export const fullscreenVideo = (
  options: {
    onChange?: (active: boolean) => void;
  } = {}
): WebViewExtension => ({
  native: { name: 'fullscreenVideo' },
  on: { fullscreen: ({ active }: { active: boolean }) => options.onChange?.(active) },
});
