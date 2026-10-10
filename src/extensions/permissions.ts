import type { WebViewExtension } from '../types';

export type PermissionResource = 'camera' | 'microphone' | 'geolocation';
export type PermissionRequestEvent = { origin: string; resources: PermissionResource[] };

/**
 * Camera, microphone and (Android) location for pages on `origins` (`*`, exact origins or `https://*.example.com`), main
 * frame only; every other origin is denied. `onPermissionRequest` may ask the OS (expo-camera, expo-audio,
 * expo-location) and answers true or false. Android grants what it answers, or every listed origin without a handler;
 * without OS permission the page's request fails. On iOS WebKit asks the OS itself; true skips WebKit's own prompt,
 * and without a handler WebKit prompts. iOS location follows WebKit's default prompt.
 */
export const permissions = (options: {
  origins: string[];
  onPermissionRequest?: (request: PermissionRequestEvent) => boolean | Promise<boolean>;
}): WebViewExtension => ({
  native: { name: 'permissions', config: { origins: options.origins } },
  on: { permissionRequest: options.onPermissionRequest },
});
