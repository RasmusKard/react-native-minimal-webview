import type { WebViewExtension } from '../types';

/**
 * HTML5 fullscreen video on Android (system bars hide, back exits). iOS has it built in.
 * `onChange(active)` reports entering and leaving fullscreen on Android.
 */
export const fullscreenVideo = (
  options: {
    onChange?: (active: boolean) => void;
    /** Android: 'unlock' lets a portrait-locked app rotate while a video is fullscreen. Default 'keep'. */
    orientation?: 'keep' | 'unlock';
  } = {}
): WebViewExtension => ({
  native: { name: 'fullscreenVideo', config: { orientation: options.orientation ?? 'keep' } },
  on: { fullscreen: ({ active }: { active: boolean }) => options.onChange?.(active) },
});
