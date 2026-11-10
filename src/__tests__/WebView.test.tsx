import { createContext, runInContext } from 'node:vm';
import { type RefObject, act, createRef, useState } from 'react';
import { AppState, Platform, Text } from 'react-native';
import { createRoot } from 'test-renderer';

import { AndroidWebView, WebView } from '../WebView';
import { CONNECTION, createBridge } from '../bridge/createBridge';
import { defaultNavigationRules } from '../defaultNavigationRules';
import { createWebViewRef, useWebViewState } from '../refStore';
import type {
  AndroidSettings,
  HookExtension,
  NavigationRequest,
  NavigationRule,
  NavigationState,
  SettingValue,
  WebViewProps,
  WebViewRef,
  WebViewRefObject,
} from '../types';

const mockAnswer = jest.fn();
const mockNavigate = jest.fn();
const mockEvaluate = jest.fn(async (_script: string) => '{"a":1}');
const mockHook = jest.fn(async (name: string, method: string, args: string) =>
  JSON.stringify({ name, method, args })
);
const mockBridgePost = jest.fn<void, [json: string]>();
const mockMount = jest.fn();
const mockNativeModule = {
  defaultUserAgent: 'Mozilla/5.0 (Android)',
  warmUp: jest.fn(),
  preconnect: jest.fn(),
  setWebContentsDebuggingEnabled: jest.fn(),
};
// The view is a host element of the name WebView.tsx asks for (MinimalWebView), whose ref has the native `answer`,
// `goBack`, `goForward`, `reload`, `stopLoading`, `bridgePost`, `evaluate`, `get`, `call` and `hook` methods; `get`,
// `call` and `hook` echo their request as JSON. The module is found by that name only.
jest.mock('expo', () => {
  const { createElement, useEffect, useImperativeHandle } =
    jest.requireActual<typeof import('react')>('react');
  return {
    requireNativeView:
      (name: string) =>
      ({ ref, ...props }: { ref: unknown }) => {
        useEffect(() => {
          mockMount();
        }, []);
        useImperativeHandle(ref as never, () => ({
          answer: mockAnswer,
          goBack: () => void mockNavigate('back'),
          goForward: () => void mockNavigate('forward'),
          reload: () => void mockNavigate('reload'),
          stopLoading: () => void mockNavigate('stop'),
          bridgePost: mockBridgePost,
          evaluate: mockEvaluate,
          get: async (path: string) => JSON.stringify({ get: path }),
          call: async (path: string, args: string) => JSON.stringify({ call: path, args }),
          hook: mockHook,
        }));
        return createElement(name, props);
      },
    requireNativeModule: (name: string) =>
      name === 'MinimalWebView' ? mockNativeModule : undefined,
  };
});

interface NativeTestProps {
  [prop: string]: unknown;
  [handler: `on${string}`]: (event: { nativeEvent: object }) => Promise<void>;
  settings: string;
  hookOptions: Record<string, unknown>;
  requestHandlers: string[];
}

/** The props of the `i`th native view under `root`. */
const nativeAt = (root: ReturnType<typeof createRoot>, i = 0) =>
  root.container.queryAll((node) => node.type === 'MinimalWebView')[i]!.props as NativeTestProps;

/** Renders a WebView of example.com with `props`; `show` renders it again with other props. */
async function mount(props: Partial<WebViewProps> = {}) {
  const root = createRoot();
  const show = (next: Partial<WebViewProps>) =>
    act(async () => root.render(<WebView source={{ uri: 'https://example.com' }} {...next} />));
  await show(props);
  const native = (i = 0) => nativeAt(root, i);
  const fire = (event: `on${string}`, nativeEvent: object, i = 0) =>
    act(async () => {
      await native(i)[event]({ nativeEvent });
    });
  return { root, show, native, fire };
}

const navState = (patch: Partial<NavigationState> = {}): NavigationState => ({
  url: '',
  pendingUrl: null,
  title: '',
  loading: false,
  progress: 0,
  canGoBack: false,
  canGoForward: false,
  outcome: null,
  ...patch,
});

const viewProps = { testID: 'web', accessibilityLabel: 'Checkout' };

describe('WebView', () => {
  afterEach(() => jest.restoreAllMocks());

  it('forwards ViewProps to the native view, but not its own props', async () => {
    const native = (await mount({ ...viewProps, onLoadEnd: () => {} })).native();
    expect(native).toMatchObject(viewProps);
    expect(native).not.toHaveProperty('onLoadEnd');
  });

  it('takes every native event without the callback props', async () => {
    const error = jest.spyOn(console, 'error');
    const { fire } = await mount();
    await fire('onNavigationState', navState({ url: 'https://example.com/', loading: true }));
    await fire('onNavigationState', navState({ url: 'https://example.com/' }));
    await fire('onNavigation', { url: 'https://example.com/', action: 'external' });
    await fire('onProcessGone', { didCrash: true, recovered: true });
    await fire('onError', { kind: 'http', url: 'https://example.com/', statusCode: 500 });
    await fire('onBridge', { message: '{}', origin: 'https://example.com' });
    await fire('onBridge', { navigated: true });
    await fire('onBridge', { unavailable: true });
    await fire('onHookEvent', { key: 'sample', name: 'note', payload: {} });
    await fire('onHookEvent', { key: 'core', name: 'onFileRequest', payload: {} });
    expect(error).not.toHaveBeenCalled();
  });

  it('sends pullToRefresh, and on iOS sharedCookies, as undefined unless set', async () => {
    expect((await mount()).native()).toMatchObject({
      pullToRefresh: undefined,
      sharedCookies: undefined,
    });
    expect((await mount({ pullToRefresh: true, sharedCookies: true })).native()).toMatchObject({
      pullToRefresh: true,
      sharedCookies: true,
    });
    jest.replaceProperty(Platform, 'OS', 'android');
    expect((await mount({ sharedCookies: true })).native().sharedCookies).toBeUndefined();
  });

  it('sends defaultNavigationRules, the native vectors’ defaults, for unset rules', async () => {
    const vectors = jest.requireActual<{ rulesets: Record<string, unknown> }>(
      './vectors/navigation-rules.json'
    );
    expect(defaultNavigationRules).toEqual(vectors.rulesets.defaults);
    expect(Object.isFrozen(defaultNavigationRules[0]?.scheme)).toBe(true);
    expect((await mount()).native().navigationRules).toBe(defaultNavigationRules);
    const none: NavigationRule[] = [];
    expect((await mount({ navigationRules: none })).native().navigationRules).toBe(none);
    const rules = [{ scheme: ['myapp'], action: 'external' as const }];
    expect((await mount({ navigationRules: rules })).native().navigationRules).toBe(rules);
  });

  it('AndroidWebView: defaultUserAgent is null, and the functions do nothing, on iOS', () => {
    AndroidWebView.warmUp();
    AndroidWebView.preconnect('https://example.com');
    AndroidWebView.setWebContentsDebuggingEnabled(true);
    expect(AndroidWebView.defaultUserAgent).toBeNull();
    expect(mockNativeModule.warmUp).not.toHaveBeenCalled();
    expect(mockNativeModule.preconnect).not.toHaveBeenCalled();
    expect(mockNativeModule.setWebContentsDebuggingEnabled).not.toHaveBeenCalled();
  });

  it("AndroidWebView is the native module's on Android", () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    AndroidWebView.warmUp();
    AndroidWebView.preconnect('https://example.com');
    AndroidWebView.setWebContentsDebuggingEnabled(false);
    expect(AndroidWebView.defaultUserAgent).toBe('Mozilla/5.0 (Android)');
    expect(mockNativeModule.warmUp).toHaveBeenCalledTimes(1);
    expect(mockNativeModule.preconnect).toHaveBeenCalledWith('https://example.com');
    expect(mockNativeModule.setWebContentsDebuggingEnabled).toHaveBeenCalledWith(false);
  });
});

describe('load events and errors', () => {
  async function renderLoads() {
    const seen: string[] = [];
    const { fire } = await mount({
      onError: (event) => seen.push(`error:${event.kind}`),
      onLoadStart: () => seen.push('start'),
      onLoadEnd: ({ outcome }) => seen.push(`end:${String(outcome)}`),
    });
    return { seen, fire };
  }
  const url = 'https://example.com/';

  it('fires start and end on the edges of loading, with the outcome native set', async () => {
    const { seen, fire } = await renderLoads();
    await fire('onNavigationState', navState({ url, loading: true }));
    await fire('onNavigationState', navState({ url, loading: true, progress: 0.5 }));
    await fire('onNavigationState', navState({ url, outcome: 'finished' }));
    await fire('onNavigationState', navState({ url, outcome: 'finished', title: 'Title' }));
    expect(seen).toEqual(['start', 'end:finished']);
  });

  it('an error before the end still gives one end', async () => {
    const { seen, fire } = await renderLoads();
    await fire('onNavigationState', navState({ url, loading: true }));
    await fire('onError', {
      kind: 'network',
      url: 'https://x.invalid/',
      code: -1003,
      description: 'dns',
    });
    await fire('onNavigationState', navState({ url, outcome: 'failed' }));
    expect(seen).toEqual(['start', 'error:network', 'end:failed']);
  });

  it('reports an HTTP error as it came, without the view tag', async () => {
    const onError = jest.fn();
    const { fire } = await mount({ onError });
    const failure = { kind: 'http', url: 'https://example.com/x', statusCode: 404 };
    await fire('onError', { ...failure, target: 42 });
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('reports a failed load as it came', async () => {
    const onError = jest.fn();
    const { fire } = await mount({ onError });
    const failure = {
      kind: 'network',
      url: 'https://example.com/',
      code: -1009,
      description: 'offline',
    };
    await fire('onError', failure);
    expect(onError).toHaveBeenCalledWith(failure);
  });
});

describe('extensions', () => {
  const ext = (key: string, options?: unknown, onEvent?: HookExtension['onEvent']) => ({
    key,
    options,
    onEvent,
  });

  const event = (key: string, name: string, askId?: number) => ({
    key,
    name,
    payload: { n: 1 },
    askId,
  });

  afterEach(() => mockAnswer.mockClear());

  it("sends each extension's options by key, true when unset, and a change reaches the same native view", async () => {
    mockMount.mockClear();
    const { native, show } = await mount({
      extensions: [ext('sample', { mode: 'a' }), ext('other')],
    });
    expect(native().hookOptions).toEqual({ sample: { mode: 'a' }, other: true });
    await show({ extensions: [ext('sample', { mode: 'b' }), ext('other')] });
    expect(mockMount).toHaveBeenCalledTimes(1);
    expect(native().hookOptions).toEqual({ sample: { mode: 'b' }, other: true });
  });

  it('leaves out falsy entries, and null and false options', async () => {
    const { native, show } = await mount({
      extensions: [ext('on'), false, null, undefined, ext('off', false), ext('gone', null)],
    });
    expect(native().hookOptions).toEqual({ on: true });
    await show({ extensions: [] });
    expect(native().hookOptions).toEqual({});
  });

  it('sends the same object while the options are the same JSON, with the latest handlers taking the events', async () => {
    const { native, show, fire } = await mount({
      extensions: [ext('a', { items: [1] }, () => 'first')],
    });
    const first = native().hookOptions;
    await show({ extensions: [ext('a', { items: [1] }, () => 'second')] });
    expect(native().hookOptions).toBe(first);
    await fire('onHookEvent', event('a', 'x', 1));
    expect(mockAnswer).toHaveBeenLastCalledWith(1, '"second"');
    await show({ extensions: [ext('a', { items: [2] })] });
    expect(native().hookOptions).not.toBe(first);
    expect(native().hookOptions).toEqual({ a: { items: [2] } });
  });

  it('warns in development when two extensions have one key, and the later one wins', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { native, fire } = await mount({
      extensions: [ext('a', 1, () => 'one'), ext('b'), ext('a', 2, () => 'two')],
    });
    expect(native().hookOptions).toEqual({ a: 2, b: true });
    await fire('onHookEvent', event('a', 'x', 1));
    expect(mockAnswer).toHaveBeenLastCalledWith(1, '"two"');
    expect(warn.mock.calls).toEqual([
      [
        '[react-native-minimal-webview] extensions: two extensions have the key a; the later one wins',
      ],
    ]);
    warn.mockRestore();
  });

  it('sends each event to the extension with its key, with the name the hook sent', async () => {
    const short = jest.fn(() => 'short');
    const long = jest.fn(async () => 'long');
    const { fire } = await mount({
      extensions: [ext('pkg', true, short), ext('pkg.dialogs', true, long)],
    });
    await fire('onHookEvent', event('pkg.dialogs', 'prompt', 1));
    expect(long).toHaveBeenCalledWith(
      { name: 'prompt', payload: { n: 1 } },
      expect.any(AbortSignal)
    );
    expect(mockAnswer).toHaveBeenLastCalledWith(1, '"long"');
    await fire('onHookEvent', event('pkg', 'dialogs.prompt'));
    expect(short).toHaveBeenCalledWith({ name: 'dialogs.prompt', payload: { n: 1 } }, undefined);
    expect(long).toHaveBeenCalledTimes(1);
    expect(mockAnswer).toHaveBeenCalledTimes(1);
  });

  it('answers null for an ask with no handler, and drops an event no extension owns', async () => {
    const own = jest.fn();
    const { show, fire } = await mount({
      extensions: [ext('a', true, own), ext('quiet')],
    });
    for (const [key, askId] of [
      ['other', 1],
      ['quiet', 2],
    ] as const) {
      await fire('onHookEvent', event(key, 'label', askId));
      expect(mockAnswer).toHaveBeenLastCalledWith(askId, 'null');
    }
    await fire('onHookEvent', event('other', 'label'));
    expect(own).not.toHaveBeenCalled();
    await show({ extensions: [false, ext('quiet')] });
    await fire('onHookEvent', event('a', 'ask', 5));
    expect(own).not.toHaveBeenCalled();
    expect(mockAnswer).toHaveBeenLastCalledWith(5, 'null');
  });

  it('answers null for an answer JSON cannot encode', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const { fire } = await mount({
      extensions: [ext('a', true, () => cyclic), ext('b', true, () => () => {})],
    });
    await fire('onHookEvent', event('a', 'x', 1));
    expect(mockAnswer).toHaveBeenLastCalledWith(1, 'null');
    await fire('onHookEvent', event('b', 'x', 2));
    expect(mockAnswer).toHaveBeenLastCalledWith(2, 'null');
  });

  it('answers null and logs when an onEvent throws', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { fire } = await mount({
      extensions: [
        ext('a', true, () => {
          throw new Error('no');
        }),
      ],
    });
    await fire('onHookEvent', event('a', 'x', 1));
    expect(mockAnswer).toHaveBeenLastCalledWith(1, 'null');
    expect(error).toHaveBeenCalledWith(
      '[react-native-minimal-webview] onEvent failed for a.x',
      expect.any(Error)
    );
    error.mockRestore();
  });
});

it('takes a ref to a WebViewRef, and no other ref', () => {
  const ref = createRef<WebViewRef>();
  const element = <WebView source={{ uri: 'https://example.com' }} ref={ref} />;
  // @ts-expect-error because the ref is a Text's, not a WebViewRef
  const wrong = <WebView source={{ uri: 'https://example.com' }} ref={createRef<Text>()} />;
  expect([element, wrong]).toHaveLength(2);
});

it('takes ref={null}', async () => {
  expect((await mount({ ref: null })).native()).toBeDefined();
});

describe('bridge', () => {
  const page = 'https://example.com';
  const newBridge = () => createBridge({ allowedOrigins: [page] });
  const posted = () => JSON.parse(mockBridgePost.mock.lastCall?.[0] ?? '') as unknown;

  it("gives native the page client and origins, and answers a page's call with its origin", async () => {
    const bridge = newBridge();
    bridge.handle('who', (_, sender) => sender.origin);
    const { native, fire } = await mount({ bridge });
    expect(native()).toMatchObject({
      bridgeScript: bridge[CONNECTION].script,
      bridgeOrigins: [page],
    });
    const call = { doc: 'd1', kind: 'call', id: 'p1', method: 'who' };
    await fire('onBridge', { message: JSON.stringify(call), origin: `${page}:8443` });
    expect(posted()).toEqual({ doc: 'd1', kind: 'result', id: 'p1', value: `${page}:8443` });
  });

  it('passes navigated and unavailable on to the bridge', async () => {
    const bridge = newBridge();
    const { fire } = await mount({ bridge });
    await fire('onBridge', { message: JSON.stringify({ doc: 'd1', kind: 'ready' }), origin: page });
    const sent = bridge.call('x');
    await fire('onBridge', { navigated: true });
    await expect(sent).rejects.toMatchObject({ code: 'navigated' });
    await fire('onBridge', { unavailable: true });
    await expect(bridge.call('x')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('detaches at unmount, so the bridge can go in the next WebView', async () => {
    const bridge = newBridge();
    const { root } = await mount({ bridge });
    const pending = bridge.call('x');
    await act(async () => root.unmount());
    await expect(pending).rejects.toMatchObject({ code: 'navigated' });
    await mount({ bridge });
  });

  it('recreates the native view for another bridge, not for the same one', async () => {
    const bridge = newBridge();
    mockMount.mockClear();
    const { show } = await mount({ bridge });
    await show({ bridge });
    expect(mockMount).toHaveBeenCalledTimes(1);
    await show({ bridge: newBridge() });
    expect(mockMount).toHaveBeenCalledTimes(2);
  });

  it('warns in development, once, when another bridge replaces the bridge', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const bridge = newBridge();
    const { show } = await mount({ bridge });
    await show({});
    await show({ bridge });
    await show({ bridge });
    expect(warn).not.toHaveBeenCalled();
    await show({ bridge: newBridge() });
    await show({ bridge: newBridge() });
    expect(warn.mock.calls).toEqual([
      [
        '[react-native-minimal-webview] bridge: another bridge recreated the WebView, and its page loaded again; ' +
          'create the bridge once, at module scope or with useMemo',
      ],
    ]);
  });
});

describe('injectedScripts', () => {
  const code = 'function secret() {}\nconst local = 1;\nwindow.ran = true;';
  const nativeCode = async (origins: string[]) => {
    const { native } = await mount({ injectedScripts: [{ code, allFrames: true, origins }] });
    const scripts = native().injectedScripts as { code: string }[];
    expect(scripts).toEqual([{ code: expect.any(String) as string, allFrames: true }]);
    return scripts[0]!.code;
  };
  /** Runs `script` as a document-start script in a frame of `origin`, after `before` patched its built-ins. */
  const run = (script: string, origin: string, before = '') => {
    const frame = createContext({ location: { origin } });
    runInContext('window = globalThis;', frame);
    runInContext(before, frame);
    runInContext(script, frame);
    return runInContext(
      '({ ran: window.ran === true, secret: typeof secret, local: typeof local })',
      frame
    ) as Record<string, unknown>;
  };

  it("sends a script with '*' unchanged and without origins", async () => {
    expect(await nativeCode(['https://example.com', '*'])).toBe(code);
  });

  it('runs a scoped script only on its origins, and its declarations stay inside it', async () => {
    const script = await nativeCode(['https://example.com', 'https://*.example.org:8443']);
    const local = { secret: 'undefined', local: 'undefined' };
    expect(run(script, 'https://example.com')).toEqual({ ran: true, ...local });
    expect(run(script, 'https://a.b.example.org:8443')).toEqual({ ran: true, ...local });
    for (const origin of ['https://example.org:8443', 'https://evil.com', 'null'])
      expect(run(script, origin)).toEqual({ ran: false, ...local });
  });

  it("is not fooled by a frame's patched built-ins", async () => {
    const script = await nativeCode(['https://example.com']);
    const patch = `
      String.prototype.toLowerCase = () => 'https://example.com';
      String.prototype.endsWith = String.prototype.startsWith = String.prototype.includes = () => true;
      Array.prototype.some = Array.prototype.includes = () => true;
      Array.prototype.indexOf = () => 0;
      Object.defineProperty(Object.prototype, 'any', { get: () => true });`;
    expect(run(script, 'https://evil.com', patch).ran).toBe(false);
  });

  it('throws at render for a script without origins or with an invalid rule', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const scripts = (origins: unknown) => [{ code, origins }] as WebViewProps['injectedScripts'];
    await expect(mount({ injectedScripts: scripts(undefined) })).rejects.toThrow('needs origins');
    await expect(mount({ injectedScripts: scripts(['example.com']) })).rejects.toThrow(
      'invalid origins ["example.com"]'
    );
  });
});

describe('ref.hook', () => {
  it('sends the arguments as JSON and parses the reply', async () => {
    const ref = createRef<WebViewRef>();
    await mount({ ref });
    expect(await ref.current?.hook('sample', 'count', [1, null])).toEqual({
      name: 'sample',
      method: 'count',
      args: '[1,null]',
    });
    expect(await ref.current?.hook('sample', 'count')).toMatchObject({ args: '[]' });
  });
});

describe('platform settings', () => {
  const settingsIn = (native: NativeTestProps) =>
    JSON.parse(native.settings) as Record<string, Record<string, unknown>>;
  const settingsOf = async (props: Partial<WebViewProps>) =>
    settingsIn((await mount(props)).native());

  it('are the defaults alone without props (jest runs as iOS)', async () => {
    expect(await settingsOf({})).toEqual({
      configuration: { allowsInlineMediaPlayback: true },
      webView: { inspectable: true },
      scrollView: { directionalLockEnabled: true },
    });
  });

  it('put userAgent over the app keys, the app keys over the defaults, and keep the other roots', async () => {
    const settings = await settingsOf({
      userAgent: 'Agent/1',
      ios: {
        configuration: {
          allowsInlineMediaPlayback: false,
          mediaTypesRequiringUserActionForPlayback: 0,
        },
        preferences: { javaScriptCanOpenWindowsAutomatically: true },
        webView: {
          customUserAgent: 'Overridden/0',
          inspectable: false,
          allowsBackForwardNavigationGestures: true,
        },
        scrollView: { bounces: false },
      },
    });
    expect(settings).toEqual({
      configuration: {
        allowsInlineMediaPlayback: false,
        mediaTypesRequiringUserActionForPlayback: 0,
      },
      preferences: { javaScriptCanOpenWindowsAutomatically: true },
      webView: {
        customUserAgent: 'Agent/1',
        inspectable: false,
        allowsBackForwardNavigationGestures: true,
      },
      scrollView: { directionalLockEnabled: true, bounces: false },
    });
  });

  it('let an app key win over a react-native-webview default, which a removed key goes back to', async () => {
    const { show, native } = await mount({
      ios: { scrollView: { directionalLockEnabled: false } },
    });
    expect(settingsIn(native()).scrollView).toEqual({ directionalLockEnabled: false });
    await show({});
    expect(settingsIn(native()).scrollView).toEqual({ directionalLockEnabled: true });
  });

  it('send a root’s other keys among its own, a generated key winning', async () => {
    // The types refuse a generated key under other; JavaScript can still send one.
    const other: Record<string, SettingValue> = { nope: 1, bounces: true };
    const settings = await settingsOf({ ios: { scrollView: { bounces: false, other } } });
    expect(settings.scrollView).toEqual({ directionalLockEnabled: true, nope: 1, bounces: false });
  });

  const userAgentApp = (applicationNameForUserAgent: string) => ({
    ios: { configuration: { applicationNameForUserAgent } },
  });

  it('recreate the native view for a changed configuration key, with the new settings', async () => {
    mockMount.mockClear();
    const { show, native } = await mount(userAgentApp('App/1'));
    await show(userAgentApp('App/2'));
    expect(mockMount).toHaveBeenCalledTimes(2);
    expect(settingsIn(native()).configuration?.applicationNameForUserAgent).toBe('App/2');
  });

  it('keep the native view when only the key order of the configuration changes', async () => {
    mockMount.mockClear();
    const { show } = await mount({
      ios: {
        configuration: {
          applicationNameForUserAgent: 'App/1',
          limitsNavigationsToAppBoundDomains: true,
        },
      },
    });
    await show({
      ios: {
        configuration: {
          limitsNavigationsToAppBoundDomains: true,
          applicationNameForUserAgent: 'App/1',
        },
      },
    });
    expect(mockMount).toHaveBeenCalledTimes(1);
  });

  describe('on Android', () => {
    beforeEach(() => jest.replaceProperty(Platform, 'OS', 'android'));
    afterEach(() => jest.restoreAllMocks());

    it('are the defaults alone without props', async () => {
      expect(await settingsOf({})).toEqual({
        settings: { userAgentString: null, useWideViewPort: true, loadWithOverviewMode: true },
        webView: { acceptThirdPartyCookies: true },
      });
    });

    it('put userAgent over the app keys, and the app keys over the defaults', async () => {
      const settings = await settingsOf({
        userAgent: 'Agent/1',
        android: {
          settings: { userAgentString: 'Overridden/0', textZoom: 120, useWideViewPort: false },
          webView: { overScrollMode: 2 },
        },
        ios: { webView: { inspectable: false } },
      });
      expect(settings).toEqual({
        settings: {
          userAgentString: 'Agent/1',
          useWideViewPort: false,
          loadWithOverviewMode: true,
          textZoom: 120,
        },
        webView: { acceptThirdPartyCookies: true, overScrollMode: 2 },
      });
    });

    it('send a root the types lack, for native to report', async () => {
      // Only untyped JavaScript can name one.
      const android = { nope: { a: 1 } } as AndroidSettings;
      expect((await settingsOf({ android })).nope).toEqual({ a: 1 });
    });

    it('let an app key win over a react-native-webview default, which a removed key goes back to', async () => {
      const { show, native } = await mount({
        android: { webView: { acceptThirdPartyCookies: false } },
      });
      expect(settingsIn(native()).webView).toEqual({ acceptThirdPartyCookies: false });
      await show({});
      expect(settingsIn(native()).webView).toEqual({ acceptThirdPartyCookies: true });
    });

    it('keep the native view when an ios.configuration key changes', async () => {
      mockMount.mockClear();
      const { show } = await mount(userAgentApp('App/1'));
      await show(userAgentApp('App/2'));
      expect(mockMount).toHaveBeenCalledTimes(1);
    });
  });

  it('logs native warnings', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { fire } = await mount();
    await fire('onHookEvent', {
      key: 'core',
      name: 'warning',
      payload: { message: 'ios.scrollView.nope: no such property' },
    });
    expect(warn).toHaveBeenCalledWith(
      '[react-native-minimal-webview] ios.scrollView.nope: no such property'
    );
    expect(mockAnswer).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('page requests', () => {
  const ask = (name: string, payload: object, askId?: number) => ({
    key: 'core',
    name,
    payload,
    askId,
  });

  beforeEach(() => mockAnswer.mockClear());

  it('tells native which requests have a prop, as the same array until that set changes', async () => {
    const { show, native } = await mount({ onDownload: () => {} });
    const first = native().requestHandlers;
    expect(first).toEqual(['onDownload']);
    await show({ onDownload: () => {} });
    expect(native().requestHandlers).toBe(first);
    await show({ onDownload: () => {}, onPermissionRequest: () => true });
    expect(native().requestHandlers).toEqual(['onPermissionRequest', 'onDownload']);
    await show({});
    expect(native().requestHandlers).toEqual([]);
  });

  it('routes each request to its prop and answers with its result', async () => {
    const onFileRequest = jest.fn(async () => ['file:///a.txt']);
    const onFullscreenChange = jest.fn();
    const onDownload = jest.fn();
    const onNavigationRequest = jest.fn(async () => 'allow' as const);
    const { fire } = await mount({
      onFileRequest,
      onFullscreenChange,
      onDownload,
      onNavigationRequest,
    });
    await fire(
      'onHookEvent',
      ask('onFileRequest', { accept: [], multiple: false, capture: false }, 1)
    );
    expect(onFileRequest).toHaveBeenCalledWith(
      { accept: [], multiple: false, capture: false },
      expect.any(AbortSignal)
    );
    expect(mockAnswer).toHaveBeenCalledWith(1, '["file:///a.txt"]');
    await fire('onHookEvent', ask('onFullscreenChange', { active: true }));
    expect(onFullscreenChange).toHaveBeenCalledWith({ active: true }, undefined);
    const failure = {
      ok: false,
      kind: 'http',
      filename: 'a.txt',
      url: 'https://a.test/a',
      statusCode: 404,
    };
    await fire('onHookEvent', ask('onDownload', failure));
    expect(onDownload).toHaveBeenCalledWith(failure, undefined);
    const request = {
      url: 'https://a.example',
      mainFrame: true,
      newWindow: false,
      userInitiated: true,
    };
    await fire('onHookEvent', ask('onNavigationRequest', request, 2));
    expect(onNavigationRequest).toHaveBeenCalledWith(request, expect.any(AbortSignal));
    expect(mockAnswer).toHaveBeenLastCalledWith(2, '"allow"');
    expect(mockAnswer).toHaveBeenCalledTimes(2);
  });

  it('answers null when the prop is gone or rejects', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { fire } = await mount({
      onPermissionRequest: async () => {
        throw new Error('no');
      },
    });
    await fire(
      'onHookEvent',
      ask('onPermissionRequest', { origin: 'https://example.com', resources: ['camera'] }, 2)
    );
    expect(mockAnswer).toHaveBeenLastCalledWith(2, 'null');
    expect(error).toHaveBeenCalledWith(
      '[react-native-minimal-webview] onPermissionRequest failed',
      expect.any(Error)
    );
    await fire(
      'onHookEvent',
      ask('onFileRequest', { accept: [], multiple: false, capture: false }, 3)
    );
    expect(mockAnswer).toHaveBeenLastCalledWith(3, 'null');
    error.mockRestore();
  });

  it('aborts the signal of an ask native cancels, and drops its late answer', async () => {
    let release = (_: boolean) => {};
    let signal: AbortSignal | undefined;
    const { fire } = await mount({
      onPermissionRequest: (_, s) => {
        signal = s;
        return new Promise<boolean>((resolve) => (release = resolve));
      },
    });
    const asked = fire(
      'onHookEvent',
      ask('onPermissionRequest', { origin: 'https://a.example', resources: [] }, 5)
    );
    await fire('onHookEvent', ask('askCancelled', { askId: 6 }));
    expect(signal?.aborted).toBe(false);
    await fire('onHookEvent', ask('askCancelled', { askId: 5 }));
    expect(signal?.aborted).toBe(true);
    release(true);
    await asked;
    expect(mockAnswer).not.toHaveBeenCalled();
  });

  it('aborts the asks in flight at unmount, not the answered ones', async () => {
    const signals: AbortSignal[] = [];
    const { root, native, fire } = await mount({
      onPermissionRequest: (_, signal) => {
        signals.push(signal);
        return new Promise<boolean>((resolve) =>
          signal.addEventListener('abort', () => resolve(false))
        );
      },
      onFileRequest: (_, signal) => {
        signals.push(signal);
        return [];
      },
    });
    // Outside act: an open act scope would hold back the unmount's effect cleanups.
    const asked = native().onHookEvent({
      nativeEvent: { key: 'core', name: 'onPermissionRequest', payload: {}, askId: 1 },
    });
    await fire(
      'onHookEvent',
      ask('onFileRequest', { accept: [], multiple: false, capture: false }, 2)
    );
    await act(async () => root.unmount());
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    await asked;
  });

  it('asks onOpenExternal with the request and answers its result; undefined and a throw answer null, which the core counts as opened', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onOpenExternal = jest
      .fn<boolean | void | Promise<boolean | void>, [NavigationRequest, AbortSignal]>()
      .mockReturnValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw new Error('no');
      });
    const { fire } = await mount({ onOpenExternal });
    const request = (url: string) => ({
      url,
      mainFrame: true,
      newWindow: false,
      userInitiated: true,
    });
    await fire('onHookEvent', ask('onOpenExternal', request('intent://a#Intent;end'), 1));
    expect(mockAnswer).toHaveBeenLastCalledWith(1, 'false');
    await fire('onHookEvent', ask('onOpenExternal', request('tel:1'), 2));
    expect(mockAnswer).toHaveBeenLastCalledWith(2, 'true');
    await fire('onHookEvent', ask('onOpenExternal', request('tel:2'), 3));
    // Native counts anything but false as opened by the app, so undefined and a throw answer null.
    expect(mockAnswer).toHaveBeenLastCalledWith(3, 'null');
    await fire('onHookEvent', ask('onOpenExternal', request('tel:3'), 4));
    expect(mockAnswer).toHaveBeenLastCalledWith(4, 'null');
    expect(error).toHaveBeenCalledWith(
      '[react-native-minimal-webview] onOpenExternal failed',
      expect.any(Error)
    );
    const signal: unknown = expect.any(AbortSignal);
    expect(onOpenExternal.mock.calls).toEqual(
      ['intent://a#Intent;end', 'tel:1', 'tel:2', 'tel:3'].map((url) => [request(url), signal])
    );
    error.mockRestore();
  });
});

describe('navigation state across remounts', () => {
  const fireState = (root: ReturnType<typeof createRoot>, state: NavigationState, i = 0) =>
    act(async () => {
      await nativeAt(root, i).onNavigationState({ nativeEvent: state });
    });

  it("strips React Native's target", async () => {
    const ref = createWebViewRef();
    const onNavigation = jest.fn();
    const onProcessGone = jest.fn();
    const { fire } = await mount({ ref, onNavigation, onProcessGone });
    const target = { target: 42 };
    await fire('onNavigationState', { ...navState({ url: 'https://example.com/a' }), ...target });
    expect(ref.getState()).toStrictEqual(navState({ url: 'https://example.com/a' }));
    const navigation = {
      url: 'https://example.com/b',
      mainFrame: true,
      newWindow: false,
      userInitiated: true,
      action: 'allow',
      rule: null,
    };
    await fire('onNavigation', { ...navigation, ...target });
    await fire('onProcessGone', { didCrash: true, recovered: true, ...target });
    expect(onNavigation).toHaveBeenCalledWith(navigation);
    expect(onProcessGone).toHaveBeenCalledWith({ didCrash: true, recovered: true });
  });

  it("createWebViewRef's current is the mounted WebView's ref, and null while none is", async () => {
    const ref = createWebViewRef();
    expect(ref.current).toBeNull();
    expect(await ref.current?.get('scrollView.bounces')).toBeUndefined();

    const { root } = await mount({ ref });
    ref.current?.goBack();
    ref.current?.goForward();
    ref.current?.reload();
    ref.current?.stopLoading();
    expect(mockNavigate.mock.calls).toEqual([['back'], ['forward'], ['reload'], ['stop']]);
    expect(await ref.current?.evaluate('1')).toEqual({ a: 1 });
    expect(await ref.current?.get('scrollView.bounces')).toEqual({ get: 'scrollView.bounces' });
    expect(await ref.current?.call('clearCache', [true])).toEqual({
      call: 'clearCache',
      args: '[true]',
    });
    expect(await ref.current?.call('clearCache')).toMatchObject({ args: '[]' });
    const stale = ref.current;
    await act(async () => root.unmount());
    expect(ref.current).toBeNull();
    for (const navigate of [stale?.goBack, stale?.goForward, stale?.reload, stale?.stopLoading])
      expect(navigate).not.toThrow();
    for (const call of [
      () => stale?.evaluate('1'),
      () => stale?.get('scrollView.bounces'),
      () => stale?.call('clearCache'),
      () => stale?.hook('sample', 'count'),
    ])
      await expect(call()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('retries a ref method each frame while Android has not registered the view, then rejects with unavailable', async () => {
    const frames = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((run) => {
      run(0);
      return 0;
    });
    const fail = (code: string) => () => Promise.reject(Object.assign(new Error(code), { code }));
    const ref = createWebViewRef();
    const { root } = await mount({ ref });

    mockEvaluate.mockClear();
    mockEvaluate
      .mockImplementationOnce(fail('ERR_VIEW_NOT_FOUND'))
      .mockImplementationOnce(fail('ERR_VIEW_NOT_FOUND'));
    expect(await ref.current?.evaluate('1')).toEqual({ a: 1 });
    expect(mockEvaluate).toHaveBeenCalledTimes(3);
    expect(frames).toHaveBeenCalledTimes(2);

    mockEvaluate.mockClear();
    frames.mockClear();
    mockEvaluate.mockImplementation(fail('ERR_VIEW_NOT_FOUND'));
    await expect(ref.current?.evaluate('1')).rejects.toMatchObject({ code: 'unavailable' });
    expect(frames.mock.calls.length).toBeGreaterThan(30);
    expect(mockEvaluate).toHaveBeenCalledTimes(frames.mock.calls.length + 1);

    // In the background no frame comes, so it rejects at once.
    mockEvaluate.mockClear();
    frames.mockClear();
    // react-native's jest mock makes currentState a function, so replaceProperty can't swap it.
    const { currentState } = AppState;
    Object.assign(AppState, { currentState: 'background' });
    await expect(ref.current?.evaluate('1')).rejects.toMatchObject({ code: 'unavailable' });
    expect(frames).not.toHaveBeenCalled();
    Object.assign(AppState, { currentState });

    // Other errors are not retried.
    mockEvaluate.mockClear();
    mockEvaluate.mockImplementation(fail('script_error'));
    await expect(ref.current?.evaluate('1')).rejects.toMatchObject({ code: 'script_error' });
    expect(mockEvaluate).toHaveBeenCalledTimes(1);

    // An unmount ends a retry in progress with the documented code.
    mockEvaluate.mockClear();
    mockEvaluate.mockImplementation(fail('ERR_VIEW_NOT_FOUND'));
    const stale = ref.current;
    let unmounted: Promise<void> | undefined;
    frames.mockImplementation((run) => {
      unmounted = act(async () => root.unmount()).then(() => run(0));
      return 0;
    });
    await expect(stale?.evaluate('1')).rejects.toMatchObject({ code: 'unavailable' });
    await unmounted;
    expect(mockEvaluate).toHaveBeenCalledTimes(1);
    mockEvaluate.mockImplementation(async () => '{"a":1}');
  });

  it('rejects a ref call still pending at unmount with navigated, and ignores the late answer', async () => {
    let reply: ((json: string) => void) | undefined;
    mockHook.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        })
    );
    const ref = createWebViewRef();
    const { root } = await mount({ ref });
    const stale = ref.current;
    const pending = stale?.hook('probe', 'never').catch((error: unknown) => error);
    const answered = await stale?.hook('probe', 'now');
    expect(answered).toMatchObject({ method: 'now' });

    await act(async () => root.unmount());
    expect(await pending).toMatchObject({ code: 'navigated' });
    reply?.('1');
    await expect(stale?.hook('probe', 'after')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('getState and subscribe follow attach, detach and re-attach; detach resets to the initial state', async () => {
    const ref = createWebViewRef();
    const listener = jest.fn();
    const unsubscribe = ref.subscribe(listener);
    const root = createRoot();
    const show = (key: number | null) =>
      act(async () =>
        root.render(
          <>
            {key === null ? null : (
              <WebView key={key} ref={ref} source={{ uri: 'https://example.com' }} />
            )}
          </>
        )
      );
    await show(1);
    await fireState(root, navState({ url: 'https://example.com/a' }));
    expect(ref.getState().url).toBe('https://example.com/a');
    listener.mockClear();

    await show(2); // remount
    expect(listener).toHaveBeenCalled();
    expect(ref.getState().url).toBe('');
    await fireState(root, navState({ url: 'https://example.com/b' }));
    expect(ref.getState().url).toBe('https://example.com/b');

    listener.mockClear();
    await show(null);
    expect(listener).toHaveBeenCalled();
    expect(ref.getState()).toEqual(navState());

    listener.mockClear();
    unsubscribe();
    await show(3);
    expect(listener).not.toHaveBeenCalled();
  });

  it('another ref gets the handle and the state, and the old one is reset', async () => {
    const [one, two] = [createWebViewRef(), createWebViewRef()];
    const root = createRoot();
    const show = (ref: WebViewRefObject) =>
      act(async () => root.render(<WebView ref={ref} source={{ uri: 'https://example.com' }} />));
    await show(one);
    await fireState(root, navState({ url: 'https://example.com/a' }));
    await show(two);
    expect(two.current).not.toBeNull();
    expect(two.getState().url).toBe('https://example.com/a');
    expect(one.current).toBeNull();
    expect(one.getState()).toEqual(navState());
  });

  it('a creation-time setting change starts the state over, until the new view emits', async () => {
    const ref = createWebViewRef();
    const root = createRoot();
    const show = (name: string) =>
      act(async () =>
        root.render(
          <WebView
            ref={ref}
            source={{ uri: 'https://example.com' }}
            ios={{ configuration: { applicationNameForUserAgent: name } }}
          />
        )
      );
    await show('a');
    await fireState(root, navState({ url: 'https://example.com/a' }));
    expect(ref.getState().url).toBe('https://example.com/a');
    await show('b');
    expect(ref.current).not.toBeNull();
    expect(ref.getState()).toEqual(navState());
    await fireState(root, navState({ url: 'https://example.com/b' }));
    expect(ref.getState().url).toBe('https://example.com/b');
  });

  it('a second WebView with the same ref replaces the first, with a warning; the first unmounting leaves it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ref = createWebViewRef();
    const root = createRoot();
    const show = (first: boolean) =>
      act(async () =>
        root.render(
          <>
            {first ? <WebView ref={ref} source={{ uri: 'https://example.com' }} /> : null}
            <WebView ref={ref} source={{ uri: 'https://example.com' }} />
          </>
        )
      );
    await show(true);
    expect(warn).toHaveBeenCalledTimes(1);
    await fireState(root, navState({ url: 'https://example.com/second' }), 1);
    await fireState(root, navState({ url: 'https://example.com/first' }), 0);
    expect(ref.getState().url).toBe('https://example.com/second');
    await show(false);
    expect(ref.current).not.toBeNull();
    expect(ref.getState().url).toBe('https://example.com/second');
    warn.mockRestore();
  });

  it.each([
    ['createWebViewRef', () => createWebViewRef()],
    ['a plain ref', () => createRef<WebViewRef>()],
  ])(
    'useWebViewState follows a remount the caller does not re-render for, with %s',
    async (_, make) => {
      const ref = make() as RefObject<WebViewRef | null>;
      let remount = () => {};
      let renders = 0;
      function Reader() {
        renders++;
        return <Text>{useWebViewState(ref).url}</Text>;
      }
      function Host() {
        const [key, setKey] = useState(0);
        remount = () => setKey(key + 1);
        return <WebView key={key} ref={ref} source={{ uri: 'https://example.com' }} />;
      }
      const root = createRoot();
      await act(async () =>
        root.render(
          <>
            <Reader />
            <Host />
          </>
        )
      );
      const shown = () =>
        root.container.queryAll((node) => node.type === 'Text')[0]?.props.children as string;
      await fireState(root, navState({ url: 'https://example.com/a' }));
      expect(shown()).toBe('https://example.com/a');
      await act(async () => remount());
      expect(shown()).toBe('');
      const before = renders;
      await fireState(root, navState({ url: 'https://example.com/b' }));
      expect(shown()).toBe('https://example.com/b');
      expect(renders).toBeGreaterThan(before);
    }
  );
});
