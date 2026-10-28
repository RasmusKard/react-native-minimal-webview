import { runInNewContext } from 'node:vm';

/** The script's code on `os`: the module reads `Platform.OS` when it loads. */
function codeOn(os: 'ios' | 'android') {
  let code = '';
  jest.isolateModules(() => {
    const { Platform } = jest.requireActual<typeof import('react-native')>('react-native');
    jest.replaceProperty(Platform, 'OS', os);
    code = jest.requireActual<typeof import('../reactNativeWebViewMessages')>(
      '../reactNativeWebViewMessages'
    ).reactNativeWebViewMessages.code;
  });
  return code;
}

/** Runs `code` as a page's script, in a page with or without the bridge. */
function run(code: string, withBridge = true) {
  const bridge = {
    emit: jest.fn(),
    on: jest.fn<void, [event: string, listener: (data: unknown) => void]>(),
  };
  const window: {
    nativeBridge?: typeof bridge;
    ReactNativeWebView?: { postMessage(data: unknown): void };
    dispatchEvent: jest.Mock;
  } = { nativeBridge: withBridge ? bridge : undefined, dispatchEvent: jest.fn() };
  const document = { dispatchEvent: jest.fn() };
  runInNewContext(code, { window, document, MessageEvent });
  return { bridge, window, document };
}

describe('reactNativeWebViewMessages', () => {
  it('gives the page ReactNativeWebView.postMessage, which emits the data as a string as `rnw`', () => {
    const { bridge, window } = run(codeOn('ios'));
    window.ReactNativeWebView?.postMessage(42);
    expect(bridge.emit).toHaveBeenCalledWith('rnw', '42');
  });

  it.each([
    ['ios', 'window', 'document'],
    ['android', 'document', 'window'],
  ] as const)(
    'on %s, dispatches `rnw` from React Native as a message event on %s',
    (os, on, off) => {
      const page = run(codeOn(os));
      const [[event, listener]] = page.bridge.on.mock.calls;
      expect(event).toBe('rnw');
      listener('hi');
      expect(page[on].dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'message', data: 'hi' })
      );
      expect(page[off].dispatchEvent).not.toHaveBeenCalled();
    }
  );

  it('does nothing in a page without the bridge', () => {
    const { window } = run(codeOn('ios'), false);
    expect(window.ReactNativeWebView).toBeUndefined();
  });
});
