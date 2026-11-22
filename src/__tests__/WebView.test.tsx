import { createContext, runInContext } from 'node:vm';
import { act, createRef, useState } from 'react';
import { AppState, Platform, Text } from 'react-native';
import { createRoot } from 'test-renderer';

import { AndroidWebView, WebView } from '../WebView';
import { CONNECTION, createBridge } from '../bridge/createBridge';
import { defaultNavigationRules } from '../navigationRules';
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

const mockAnswer = jest.fn(async (_askId: number, _json: string) => {});
const mockNavigate = jest.fn(async (_to: string) => {});
const mockEvaluate = jest.fn(async (_script: string) => '{"a":1}');
const mockHook = jest.fn(async (name: string, method: string, args: string) =>
  JSON.stringify({ name, method, args })
);
const mockBridgePost = jest.fn(async (_json: string) => {});
const mockMount = jest.fn();
const mockNativeModule = {
  defaultUserAgent: 'Mozilla/5.0 (Android)',
  warmUp: jest.fn(),
  preconnect: jest.fn(async (_url: string) => {}),
  setWebContentsDebuggingEnabled: jest.fn(async (_enabled: boolean) => {}),
};
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
          goBack: () => mockNavigate('back'),
          goForward: () => mockNavigate('forward'),
          load: (url: string) => mockNavigate(`load ${url}`),
          reload: () => mockNavigate('reload'),
          stopLoading: () => mockNavigate('stop'),
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
    requireOptionalNativeModule: (name: string) =>
      name === 'MinimalWebView' ? mockNativeModule : null,
  };
});

interface NativeTestProps {
  [prop: string]: unknown;
  [handler: `on${string}`]: (event: { nativeEvent: object }) => Promise<void>;
  settings: string;
  hookOptions: Record<string, unknown>;
  requestHandlers: string[];
}

const nativeAt = (root: ReturnType<typeof createRoot>, i = 0) =>
  root.container.queryAll((node) => node.type === 'MinimalWebView')[i]!.props as NativeTestProps;

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
    await fire('onProcessGone', { cause: 'crash', recovered: true });
    await fire('onError', { kind: 'http', url: 'https://example.com/', statusCode: 500 });
    await fire('onBridge', { message: '{}', origin: 'https://example.com' });
    await fire('onBridge', { navigated: true });
    await fire('onBridge', { unavailable: true });
    await fire('onHookEvent', { key: 'sample', name: 'note', payload: {} });
    await fire('onHookEvent', { key: 'core', name: 'onFileRequest', payload: {} });
    expect(error).not.toHaveBeenCalled();
  });

  it("strips React Native's target", async () => {
    const ref = createWebViewRef();
    const onNavigation = jest.fn();
    const onProcessGone = jest.fn();
    const onError = jest.fn();
    const { fire } = await mount({ ref, onNavigation, onProcessGone, onError });
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
    await fire('onProcessGone', { cause: 'crash', recovered: true, ...target });
    const failure = { kind: 'http', url: 'https://example.com/x', statusCode: 404 };
    await fire('onError', { ...failure, ...target });
    expect(onNavigation).toHaveBeenCalledWith(navigation);
    expect(onProcessGone).toHaveBeenCalledWith({ cause: 'crash', recovered: true });
    expect(onError).toHaveBeenCalledWith(failure);
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

  it('AndroidWebView.defaultUserAgent is null while no WebView provider is available, then reads again', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const value = mockNativeModule.defaultUserAgent;
    Object.defineProperty(mockNativeModule, 'defaultUserAgent', {
      configurable: true,
      get: () => {
        throw new Error('MissingWebViewPackageException');
      },
    });
    try {
      expect(AndroidWebView.defaultUserAgent).toBeNull();
    } finally {
      Object.defineProperty(mockNativeModule, 'defaultUserAgent', { configurable: true, value });
    }
    expect(AndroidWebView.defaultUserAgent).toBe(value);
  });
});

describe('navigationRules', () => {
  const withRules = (rules: unknown) => ({ navigationRules: rules as NavigationRule[] });
  const warnings = () => jest.spyOn(console, 'warn').mockImplementation(() => {});

  it('sends valid rules as they are, an undefined field (unset) included, without a warning', async () => {
    const warn = warnings();
    const rules = [{ host: undefined, mainFrame: false, newWindow: true, action: 'ask' }];
    expect((await mount(withRules(rules))).native().navigationRules).toBe(rules);
    expect(warn).not.toHaveBeenCalled();
  });

  it("takes the native vectors' rulesets as they are, but for the two with a malformed rule", async () => {
    const warn = warnings();
    const { rulesets } = jest.requireActual<{ rulesets: Record<string, unknown> }>(
      './vectors/navigation-rules.json'
    );
    const sent: string[] = [];
    for (const [name, rules] of Object.entries(rulesets)) {
      const { native } = await mount(withRules(rules));
      if (native().navigationRules !== rules) sent.push(name);
    }
    expect(sent).toEqual(['notAList', 'unknownAction']);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  const ACTION = 'action must be one of ["allow","block","external","ask"]';
  it.each([
    [[null], 'must be an object, not null'],
    [[{ hosts: ['example.com'], action: 'allow' }], 'unknown key "hosts"'],
    [
      [{ host: 'example.com', action: 'allow' }],
      'host must be an array of strings, not "example.com"',
    ],
    [
      [{ scheme: ['https', 1], action: 'allow' }],
      'scheme must be an array of strings, not ["https",1]',
    ],
    [[{ mainFrame: 'true', action: 'allow' }], 'mainFrame must be true or false, not "true"'],
    [[{ userInitiated: null, action: 'allow' }], 'userInitiated must be true or false, not null'],
    [[{ host: ['example.com'] }], `${ACTION}, not undefined`],
  ])('blocks all at a malformed rule, and warns once, for %j', async (rules, problem) => {
    const warn = warnings();
    const good = { host: ['a.com'], action: 'allow' };
    const { native, show } = await mount(withRules([good, ...rules, good]));
    expect(native().navigationRules).toEqual([good, { action: 'block' }, good]);
    await show(withRules([good, ...rules, good]));
    expect(warn.mock.calls).toEqual([
      [
        `[react-native-minimal-webview] navigationRules[1]: ${problem}; it blocks every navigation that reaches it`,
      ],
    ]);
  });

  // Not in the it.each above: its %j title can't format these either.
  it.each([
    ['a BigInt', () => ({ action: 10n }), `${ACTION}, not 10`],
    [
      'a circular value',
      () => {
        const host: unknown[] = [];
        host.push(host);
        return { host, action: 'allow' };
      },
      'host must be an array of strings, not [object Array]',
    ],
  ])('blocks all at a rule with %s, and warns', async (_, rule, problem) => {
    const warn = warnings();
    const good = { host: ['a.com'], action: 'allow' };
    const { native } = await mount(withRules([good, rule(), good]));
    expect(native().navigationRules).toEqual([good, { action: 'block' }, good]);
    expect(warn).toHaveBeenCalledWith(
      `[react-native-minimal-webview] navigationRules[1]: ${problem}; it blocks every navigation that reaches it`
    );
  });

  it('blocks all at a hole in a sparse rules array, and warns', async () => {
    const warn = warnings();
    const good = { host: ['a.com'], action: 'allow' };
    const rules: unknown[] = [good];
    rules[2] = good;
    const { native } = await mount(withRules(rules));
    expect(native().navigationRules).toEqual([good, { action: 'block' }, good]);
    expect(warn).toHaveBeenCalledWith(
      '[react-native-minimal-webview] navigationRules[1]: must be an object, not undefined; it blocks every navigation that reaches it'
    );
  });

  it('treats rules that are not an array as none, with a warning', async () => {
    const warn = warnings();
    const { native } = await mount(withRules({ 0: { action: 'allow' } }));
    expect(native().navigationRules).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      '[react-native-minimal-webview] navigationRules: must be an array, not {"0":{"action":"allow"}}; treated as []'
    );
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

  it("sends each extension's options by key, true when unset, and a change reaches the same native view", async () => {
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

  it("an ask goes to the extension's onAsk with a signal, and an emit to its onEvent", async () => {
    const onAsk = jest.fn(() => 'asked');
    const onEvent = jest.fn(() => 'emitted');
    const { fire } = await mount({ extensions: [{ key: 'a', onAsk, onEvent }] });
    await fire('onHookEvent', event('a', 'x', 7));
    await fire('onHookEvent', event('a', 'y'));
    expect(onAsk.mock.calls).toEqual([[{ name: 'x', payload: { n: 1 } }, expect.any(AbortSignal)]]);
    expect(mockAnswer).toHaveBeenLastCalledWith(7, '"asked"');
    expect(onEvent.mock.calls).toEqual([[{ name: 'y', payload: { n: 1 } }, undefined]]);
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

  it.each(['onEvent', 'onAsk'] as const)(
    'answers null and logs when an %s throws',
    async (member) => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const throwing = () => {
        throw new Error('no');
      };
      const { fire } = await mount({ extensions: [{ key: 'a', [member]: throwing }] });
      await fire('onHookEvent', event('a', 'x', 1));
      expect(mockAnswer).toHaveBeenLastCalledWith(1, 'null');
      expect(error).toHaveBeenCalledWith(
        `[react-native-minimal-webview] ${member} failed for a.x`,
        expect.any(Error)
      );
    }
  );
});

it('takes a ref to a WebViewRef, and no other ref', () => {
  const ref = createRef<WebViewRef>();
  const element = <WebView source={{ uri: 'https://example.com' }} ref={ref} />;
  // @ts-expect-error because the ref is a Text's, not a WebViewRef
  const wrong = <WebView source={{ uri: 'https://example.com' }} ref={createRef<Text>()} />;
  void [element, wrong];
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
    const first = await mount({ bridge });
    await first.fire('onBridge', {
      message: JSON.stringify({ doc: 'd1', kind: 'ready' }),
      origin: page,
    });
    const sent = bridge.call('sent');
    const sentError = sent.catch((error: unknown) => error);
    await act(async () => first.root.unmount());
    expect(await sentError).toMatchObject({ code: 'navigated' });
    const second = await mount({ bridge });
    const queued = bridge.call('queued');
    const queuedError = queued.catch((error: unknown) => error);
    await act(async () => second.root.unmount());
    expect(await queuedError).toMatchObject({ code: 'unavailable' });
  });

  it('recreates the native view for another bridge, not for the same one', async () => {
    const bridge = newBridge();
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
    expect(run(script, 'https://evil.com')).toEqual({ ran: false, ...local });
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

  it('sends scripts changed after mount to the same native view', async () => {
    const { native, show } = await mount({ injectedScripts: [{ code: 'a()', origins: ['*'] }] });
    await show({ injectedScripts: [{ code: 'b()', allFrames: true, origins: ['*'] }] });
    expect(native().injectedScripts).toEqual([{ code: 'b()', allFrames: true }]);
    expect(mockMount).toHaveBeenCalledTimes(1);
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

describe('ref', () => {
  it('hook sends the arguments as JSON and parses the reply', async () => {
    const ref = createRef<WebViewRef>();
    await mount({ ref });
    expect(await ref.current?.hook('sample', 'count', [1, null])).toEqual({
      name: 'sample',
      method: 'count',
      args: '[1,null]',
    });
    expect(await ref.current?.hook('sample', 'count')).toMatchObject({ args: '[]' });
  });

  it("createWebViewRef's current is the mounted WebView's ref, and null while none is", async () => {
    const ref = createWebViewRef();
    expect(ref.current).toBeNull();

    const { root } = await mount({ ref });
    ref.current?.goBack();
    ref.current?.goForward();
    ref.current?.reload();
    ref.current?.stopLoading();
    ref.current?.load('https://example.com/');
    expect(mockNavigate.mock.calls).toEqual([
      ['back'],
      ['forward'],
      ['reload'],
      ['stop'],
      ['load https://example.com/'],
    ]);
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
    stale?.load('https://example.com/');
    expect(mockNavigate).toHaveBeenCalledTimes(5);
    for (const call of [
      () => stale?.evaluate('1'),
      () => stale?.get('scrollView.bounces'),
      () => stale?.call('clearCache'),
      () => stale?.hook('sample', 'count'),
    ])
      await expect(call()).rejects.toMatchObject({ code: 'unavailable' });
  });

  describe('while Android has not registered the view', () => {
    const fail = (code: string) => () => Promise.reject(Object.assign(new Error(code), { code }));
    // react-native's jest mock makes currentState a function, so replaceProperty can't swap it.
    const { currentState } = AppState;
    let frames: jest.SpiedFunction<typeof requestAnimationFrame>;
    let ref: WebViewRefObject;
    let root: ReturnType<typeof createRoot>;
    beforeEach(async () => {
      frames = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((run) => {
        run(0);
        return 0;
      });
      ref = createWebViewRef();
      ({ root } = await mount({ ref }));
    });
    afterEach(() => {
      Object.assign(AppState, { currentState });
      mockEvaluate.mockImplementation(async () => '{"a":1}');
    });

    it('retries a ref method each frame until registered', async () => {
      mockEvaluate
        .mockImplementationOnce(fail('ERR_VIEW_NOT_FOUND'))
        .mockImplementationOnce(fail('ERR_VIEW_NOT_FOUND'));
      expect(await ref.current?.evaluate('1')).toEqual({ a: 1 });
      expect(mockEvaluate).toHaveBeenCalledTimes(3);
      expect(frames).toHaveBeenCalledTimes(2);
    });

    it('load waits for the view instead of doing nothing', async () => {
      mockNavigate.mockImplementationOnce(fail('ERR_VIEW_NOT_FOUND'));
      ref.current?.load('https://example.com/');
      await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
      expect(mockNavigate.mock.calls).toEqual([
        ['load https://example.com/'],
        ['load https://example.com/'],
      ]);
    });

    it('load does nothing, quietly, when the view never comes or unmounts while it waits', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const flush = () => act(() => new Promise<void>((resolve) => setImmediate(resolve)));
      mockNavigate.mockImplementation(fail('ERR_VIEW_NOT_FOUND'));
      ref.current?.load('https://example.com/');
      await flush();
      Object.assign(AppState, { currentState: 'background' });
      ref.current?.load('https://example.com/');
      await flush();
      mockNavigate.mockImplementation(() => new Promise(() => {}));
      ref.current?.load('https://example.com/');
      await act(async () => root.unmount());
      await flush();
      expect(error).not.toHaveBeenCalled();
      mockNavigate.mockImplementation(async () => {});
    });

    it('load logs any other error', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockNavigate.mockImplementationOnce(fail('load_failed'));
      ref.current?.load('https://example.com/');
      await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
      expect(error).toHaveBeenCalledWith(
        '[react-native-minimal-webview] load failed',
        expect.objectContaining({ code: 'load_failed' })
      );
    });

    it('rejects with unavailable after the frame budget', async () => {
      mockEvaluate.mockImplementation(fail('ERR_VIEW_NOT_FOUND'));
      await expect(ref.current?.evaluate('1')).rejects.toMatchObject({ code: 'unavailable' });
      expect(frames.mock.calls.length).toBeGreaterThan(30);
      expect(mockEvaluate).toHaveBeenCalledTimes(frames.mock.calls.length + 1);
    });

    it('rejects at once in the background', async () => {
      mockEvaluate.mockImplementation(fail('ERR_VIEW_NOT_FOUND'));
      Object.assign(AppState, { currentState: 'background' });
      await expect(ref.current?.evaluate('1')).rejects.toMatchObject({ code: 'unavailable' });
      expect(frames).not.toHaveBeenCalled();
    });

    it('does not retry other errors', async () => {
      mockEvaluate.mockImplementation(fail('script_error'));
      await expect(ref.current?.evaluate('1')).rejects.toMatchObject({ code: 'script_error' });
      expect(mockEvaluate).toHaveBeenCalledTimes(1);
    });

    it('an unmount ends a retry with unavailable', async () => {
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
    });
  });

  it('load loads no javascript: URL, however a URL parser would still read it as one, and warns', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ref = createWebViewRef();
    await mount({ ref });
    /* eslint-disable no-script-url -- because these are the URLs load must refuse */
    const refused = ['javascript:alert(1)', 'JavaScript:alert(1)', ' \u0001java\tscript:alert(1)'];
    /* eslint-enable no-script-url */
    for (const url of refused) ref.current?.load(url);
    ref.current?.load('https://example.com/?next=javascript:alert(1)');
    expect(mockNavigate.mock.calls).toEqual([
      ['load https://example.com/?next=javascript:alert(1)'],
    ]);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('load: a javascript: URL'));
  });

  it('rejects a ref call still pending at unmount with navigated', async () => {
    mockHook.mockImplementationOnce(() => new Promise(() => {}));
    const ref = createWebViewRef();
    const { root } = await mount({ ref });
    const pending = ref.current?.hook('probe', 'never').catch((error: unknown) => error);
    await act(async () => root.unmount());
    expect(await pending).toMatchObject({ code: 'navigated' });
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
    const other: Record<string, SettingValue> = { nope: 1, bounces: true };
    const settings = await settingsOf({ ios: { scrollView: { bounces: false, other } } });
    expect(settings.scrollView).toEqual({ directionalLockEnabled: true, nope: 1, bounces: false });
  });

  const userAgentApp = (applicationNameForUserAgent: string) => ({
    ios: { configuration: { applicationNameForUserAgent } },
  });

  it('recreate the native view for a changed configuration key, with the new settings', async () => {
    const ref = createWebViewRef();
    const { show, native, fire } = await mount({ ref, ...userAgentApp('App/1') });
    await fire('onNavigationState', navState({ url: 'https://example.com/a' }));
    await show({ ref, ...userAgentApp('App/2') });
    expect(mockMount).toHaveBeenCalledTimes(2);
    expect(settingsIn(native()).configuration?.applicationNameForUserAgent).toBe('App/2');
    expect(ref.current).not.toBeNull();
    expect(ref.getState()).toEqual(navState());
  });

  it('keep the native view when only the key order of the configuration changes', async () => {
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

    it('are the defaults alone without props', async () => {
      expect(await settingsOf({})).toEqual({
        settings: { useWideViewPort: true, loadWithOverviewMode: true },
        webView: { acceptThirdPartyCookies: true },
      });
    });

    it('drop the key of a removed userAgent, for native to restore', async () => {
      const { show, native } = await mount({ userAgent: 'Agent/1' });
      expect(settingsIn(native()).settings.userAgentString).toBe('Agent/1');
      await show({});
      expect(settingsIn(native()).settings).not.toHaveProperty('userAgentString');
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
  });
});

describe('page requests', () => {
  const ask = (name: string, payload: object, askId?: number) => ({
    key: 'core',
    name,
    payload,
    askId,
  });

  it('tells native which requests have a prop, as the same array until that set changes', async () => {
    const { show, native } = await mount({ onDownload: () => {} });
    const first = native().requestHandlers;
    expect(first).toEqual(['onDownload']);
    await show({ onDownload: () => {} });
    expect(native().requestHandlers).toBe(first);
    await show({ onDownload: () => {}, onPermissionRequest: () => true });
    expect(native().requestHandlers).toEqual(['onPermissionRequest', 'onDownload']);
    await show({ onNavigation: () => {} });
    expect(native().requestHandlers).toEqual(['onNavigation']);
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

  it('routes onOpenExternal and answers its result', async () => {
    const onOpenExternal = jest
      .fn<boolean | void | Promise<boolean | void>, [NavigationRequest, AbortSignal]>()
      .mockReturnValueOnce(false)
      .mockResolvedValueOnce(true);
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
    const signal: unknown = expect.any(AbortSignal);
    expect(onOpenExternal.mock.calls).toEqual(
      ['intent://a#Intent;end', 'tel:1'].map((url) => [request(url), signal])
    );
  });
});

describe('navigation state across remounts', () => {
  const fireState = (root: ReturnType<typeof createRoot>, state: NavigationState, i = 0) =>
    act(async () => {
      await nativeAt(root, i).onNavigationState({ nativeEvent: state });
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

    await show(2);
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
  });

  it('useWebViewState follows a remount the caller does not re-render for, with a plain ref', async () => {
    const ref = createRef<WebViewRef>();
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
  });
});

describe('native calls nothing awaits', () => {
  const notRegistered = Object.assign(new Error('no view'), { code: 'ERR_VIEW_NOT_FOUND' });
  const failure = new Error('native failed');
  const settled = () => act(() => new Promise<void>((resolve) => setImmediate(resolve)));
  let error: jest.SpyInstance;
  beforeEach(() => (error = jest.spyOn(console, 'error').mockImplementation(() => {})));

  it('navigation does nothing for a view Android has not registered yet, and logs any other rejection', async () => {
    const ref = createWebViewRef();
    await act(async () =>
      createRoot().render(<WebView ref={ref} source={{ uri: 'https://example.com' }} />)
    );
    const methods = ['goBack', 'goForward', 'reload', 'stopLoading'] as const;
    for (const method of methods) {
      mockNavigate.mockRejectedValueOnce(notRegistered).mockRejectedValueOnce(failure);
      ref.current?.[method]();
      ref.current?.[method]();
    }
    await settled();
    expect(error.mock.calls).toEqual(
      methods.map((method) => [`[react-native-minimal-webview] ${method} failed`, failure])
    );
  });

  it('logs a failed bridge post', async () => {
    const bridge = createBridge({ allowedOrigins: ['https://example.com'] });
    bridge.handle('ping', () => 'pong');
    const { fire } = await mount({ bridge });
    mockBridgePost.mockRejectedValueOnce(failure);
    const call = { doc: 'd1', kind: 'call', id: 'p1', method: 'ping' };
    await fire('onBridge', { message: JSON.stringify(call), origin: 'https://example.com' });
    await settled();
    expect(error).toHaveBeenCalledWith('[react-native-minimal-webview] bridgePost failed', failure);
  });

  it("logs AndroidWebView's failed calls", async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockNativeModule.preconnect.mockRejectedValueOnce(failure);
    mockNativeModule.setWebContentsDebuggingEnabled.mockRejectedValueOnce(failure);
    AndroidWebView.preconnect('https://example.com');
    AndroidWebView.setWebContentsDebuggingEnabled(true);
    await settled();
    expect(error.mock.calls).toEqual([
      ['[react-native-minimal-webview] preconnect failed', failure],
      ['[react-native-minimal-webview] setWebContentsDebuggingEnabled failed', failure],
    ]);
  });
});
