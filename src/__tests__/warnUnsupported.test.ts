import type { AndroidWebViewInfo } from '../types';

const mockGetInfo = jest.fn<AndroidWebViewInfo, []>();
jest.mock('expo', () => ({
  requireNativeView: () => 'MinimalWebView',
  requireNativeModule: () => ({ getAndroidWebViewInfo: mockGetInfo }),
}));

const device = (injection: boolean): AndroidWebViewInfo => ({
  version: '120.0',
  provider: 'com.google.android.webview',
  available: true,
  features: { WEB_MESSAGE_LISTENER: true, JS_INJECTION_IN_FRAME_AND_WORLD: injection },
});

/** A fresh module, so the per-process cache and warned set start empty. */
function load() {
  jest.resetModules();
  (require('react-native') as typeof import('react-native')).Platform.OS = 'android';
  return (require('../WebView') as typeof import('../WebView')).warnUnsupported;
}

describe('warnUnsupported', () => {
  const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  beforeEach(() => jest.clearAllMocks());

  it('warns once per prop and reads the WebView info once', () => {
    mockGetInfo.mockReturnValue(device(false));
    const warn = load();
    warn({ bridge: true, injectedScripts: false });
    warn({ bridge: true, injectedScripts: true });
    warn({ bridge: true, injectedScripts: true });
    expect(mockGetInfo).toHaveBeenCalledTimes(1);
    expect(consoleWarn.mock.calls).toEqual([
      [
        '[minimal-rn-webview] bridge needs WebView features JS_INJECTION_IN_FRAME_AND_WORLD, missing in com.google.android.webview 120.0: bridge calls reject with `unavailable`. Update Android System WebView to 146+.',
      ],
      [
        "[minimal-rn-webview] injectedScripts needs WebView features JS_INJECTION_IN_FRAME_AND_WORLD, missing in com.google.android.webview 120.0: injectedScripts don't run. Update Android System WebView to 146+.",
      ],
    ]);
  });

  it('stays quiet when the features are there, the props are unused, or the info is unavailable', () => {
    mockGetInfo.mockReturnValue(device(true));
    load()({ bridge: true, injectedScripts: true });
    mockGetInfo.mockReturnValue(device(false));
    load()({ bridge: false, injectedScripts: false });
    expect(mockGetInfo).toHaveBeenCalledTimes(1);
    mockGetInfo.mockImplementation(() => {
      throw new Error('ReactContextLost');
    });
    const warn = load();
    warn({ bridge: true, injectedScripts: true });
    warn({ bridge: true, injectedScripts: true });
    expect(mockGetInfo).toHaveBeenCalledTimes(2);
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
