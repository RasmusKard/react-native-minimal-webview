import type { AndroidWebViewInfo } from '../types';

const mockGetInfo = jest.fn<AndroidWebViewInfo, []>();
jest.mock('expo', () => ({
  requireNativeView: () => 'MinimalWebView',
  requireNativeModule: () => ({ getAndroidWebViewInfo: mockGetInfo }),
}));

const device = (documentStart: boolean, injection = documentStart): AndroidWebViewInfo => ({
  version: '120.0',
  provider: 'com.google.android.webview',
  available: true,
  features: {
    WEB_MESSAGE_LISTENER: true,
    DOCUMENT_START_SCRIPT: documentStart,
    JS_INJECTION_IN_FRAME_AND_WORLD: injection,
  },
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
    warn({ bridge: true, injectedScripts: false, endScripts: false });
    warn({ bridge: true, injectedScripts: true, endScripts: false });
    warn({ bridge: true, injectedScripts: true, endScripts: false });
    expect(mockGetInfo).toHaveBeenCalledTimes(1);
    expect(consoleWarn.mock.calls).toEqual([
      [
        '[minimal-rn-webview] bridge needs WebView features DOCUMENT_START_SCRIPT, missing in com.google.android.webview 120.0: bridge calls reject with `unavailable`. Update Android System WebView.',
      ],
      [
        "[minimal-rn-webview] injectedScripts needs WebView features DOCUMENT_START_SCRIPT, missing in com.google.android.webview 120.0: `when: 'start'` scripts don't run. Update Android System WebView.",
      ],
    ]);
  });

  it('warns only for end scripts on a WebView with document-start scripts but older than 146', () => {
    mockGetInfo.mockReturnValue(device(true, false));
    load()({ bridge: true, injectedScripts: true, endScripts: true });
    expect(consoleWarn.mock.calls).toEqual([
      [
        "[minimal-rn-webview] endScripts needs WebView features JS_INJECTION_IN_FRAME_AND_WORLD, missing in com.google.android.webview 120.0: `when: 'end'` scripts don't run (WebView 146+). Update Android System WebView.",
      ],
    ]);
  });

  it('stays quiet when the features are there, the props are unused, or the info is unavailable', () => {
    mockGetInfo.mockReturnValue(device(true));
    load()({ bridge: true, injectedScripts: true, endScripts: true });
    mockGetInfo.mockReturnValue(device(false));
    load()({ bridge: false, injectedScripts: false, endScripts: false });
    expect(mockGetInfo).toHaveBeenCalledTimes(1);
    mockGetInfo.mockImplementation(() => {
      throw new Error('ReactContextLost');
    });
    const warn = load();
    warn({ bridge: true, injectedScripts: true, endScripts: true });
    warn({ bridge: true, injectedScripts: true, endScripts: true });
    expect(mockGetInfo).toHaveBeenCalledTimes(2);
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
