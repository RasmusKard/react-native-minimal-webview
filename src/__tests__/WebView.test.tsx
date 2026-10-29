import { type RefObject, act, createRef, useState } from 'react';
import { AppState, Platform, Text } from 'react-native';
import { createRoot } from 'test-renderer';

import { WebView } from '../WebView';
import { CONNECTION, createBridge } from '../bridge/createBridge';
import { createWebViewRef, useWebViewState } from '../refStore';
import type {
  Bridge,
  NavigationRequest,
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
// `navigate`, `bridgePost`, `evaluate`, `get`, `call` and `hook` methods; `get`, `call` and `hook` echo their request as
// JSON. The module is found by that name only.
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
          navigate: mockNavigate,
          bridgePost: mockBridgePost,
          evaluate: mockEvaluate,
          get: async (path: string) => JSON.stringify({ get: path }),
          call: async (path: string, args: string, completion: string | null) =>
            JSON.stringify({ call: path, args, completion }),
          hook: mockHook,
        }));
        return createElement(name, props);
      },
    requireNativeModule: (name: string) =>
      name === 'MinimalWebView' ? mockNativeModule : undefined,
  };
});

async function render(props: Partial<WebViewProps>) {
  const root = createRoot();
  await act(async () =>
    root.render(<WebView source={{ uri: 'https://example.com' }} onLoadEnd={() => {}} {...props} />)
  );
  const native = root.container.queryAll((node) => node.type === 'MinimalWebView');
  return { native: native[0]?.props };
}

const viewProps = { testID: 'web', accessibilityLabel: 'Checkout' };

describe('WebView', () => {
  afterEach(() => jest.restoreAllMocks());

  it('forwards ViewProps to the native view, but not its own props', async () => {
    const { native } = await render(viewProps);
    expect(native).toMatchObject(viewProps);
    expect(native).not.toHaveProperty('onLoadEnd');
  });

  it('takes every native event without the callback props', async () => {
    const error = jest.spyOn(console, 'error');
    const { native } = await render({ onLoadEnd: undefined });
    const fire = (name: string, nativeEvent: object) =>
      act(async () => (native?.[name] as (event: object) => void)({ nativeEvent }));
    await fire('onNavigationState', state(true));
    await fire('onNavigationState', state(false));
    await fire('onNavigation', { url: 'https://example.com/', action: 'external' });
    await fire('onProcessGone', { didCrash: true, recovered: true });
    await fire('onError', { kind: 'http', url: 'https://example.com/', code: 500 });
    await fire('onBridge', { message: '{}', origin: 'https://example.com' });
    await fire('onBridge', { navigated: true });
    await fire('onBridge', { unavailable: true });
    await fire('onHookEvent', { name: 'sample.note', payload: {} });
    await fire('onHookEvent', { name: 'core.fileRequest', payload: {} });
    expect(error).not.toHaveBeenCalled();
  });

  it('sends pullToRefresh, and on iOS sharedCookies, as undefined unless set', async () => {
    expect((await render({})).native).toMatchObject({
      pullToRefresh: undefined,
      sharedCookies: undefined,
    });
    expect((await render({ pullToRefresh: true, sharedCookies: true })).native).toMatchObject({
      pullToRefresh: true,
      sharedCookies: true,
    });
    jest.replaceProperty(Platform, 'OS', 'android');
    expect((await render({ sharedCookies: true })).native?.sharedCookies).toBeUndefined();
  });

  it('sends defaultNavigationRules, the native vectors’ defaults, for unset or empty rules', async () => {
    const vectors = jest.requireActual<{ rulesets: Record<string, unknown> }>(
      './vectors/navigation-rules.json'
    );
    expect(WebView.defaultNavigationRules).toEqual(vectors.rulesets.defaults);
    expect(Object.isFrozen(WebView.defaultNavigationRules[0]?.scheme)).toBe(true);
    for (const navigationRules of [undefined, []])
      expect((await render({ navigationRules })).native?.navigationRules).toBe(
        WebView.defaultNavigationRules
      );
    const rules = [{ scheme: ['myapp'], action: 'external' as const }];
    expect((await render({ navigationRules: rules })).native?.navigationRules).toBe(rules);
  });

  it('WebView.android: defaultUserAgent is null, and the functions do nothing, on iOS', () => {
    WebView.android.warmUp();
    WebView.android.preconnect('https://example.com');
    WebView.android.setWebContentsDebuggingEnabled(true);
    expect(WebView.android.defaultUserAgent).toBeNull();
    expect(mockNativeModule.warmUp).not.toHaveBeenCalled();
    expect(mockNativeModule.preconnect).not.toHaveBeenCalled();
    expect(mockNativeModule.setWebContentsDebuggingEnabled).not.toHaveBeenCalled();
  });

  it("WebView.android is the native module's on Android", () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    WebView.android.warmUp();
    WebView.android.preconnect('https://example.com');
    WebView.android.setWebContentsDebuggingEnabled(false);
    expect(WebView.android.defaultUserAgent).toBe('Mozilla/5.0 (Android)');
    expect(mockNativeModule.warmUp).toHaveBeenCalledTimes(1);
    expect(mockNativeModule.preconnect).toHaveBeenCalledWith('https://example.com');
    expect(mockNativeModule.setWebContentsDebuggingEnabled).toHaveBeenCalledWith(false);
  });
});

const state = (loading: boolean, outcome: NavigationState['outcome'] = null): NavigationState => ({
  url: 'https://example.com/',
  pendingUrl: null,
  title: '',
  loading,
  progress: 0,
  canGoBack: false,
  canGoForward: false,
  outcome,
});

describe('load events and errors', () => {
  async function renderLoads() {
    const seen: string[] = [];
    const root = createRoot();
    await act(async () =>
      root.render(
        <WebView
          source={{ uri: 'https://example.com' }}
          onError={(event) => seen.push(`error:${event.kind}`)}
          onLoadStart={() => seen.push('start')}
          onLoadEnd={({ outcome }) => seen.push(`end:${String(outcome)}`)}
        />
      )
    );
    const props = () =>
      root.container.queryAll((node) => node.type === 'MinimalWebView')[0]?.props as {
        onError: (event: { nativeEvent: Record<string, unknown> }) => void;
        onNavigationState: (event: { nativeEvent: NavigationState }) => void;
      };
    const fireState = (nativeEvent: NavigationState) =>
      act(async () => props().onNavigationState({ nativeEvent }));
    const fireError = (nativeEvent: Record<string, unknown>) =>
      act(async () => props().onError({ nativeEvent }));
    return { seen, fireState, fireError };
  }

  it('fires start and end on the edges of loading, with the outcome native set', async () => {
    const { seen, fireState } = await renderLoads();
    await fireState(state(true));
    await fireState({ ...state(true), progress: 0.5 });
    await fireState(state(false, 'finished'));
    await fireState({ ...state(false, 'finished'), title: 'Title' });
    expect(seen).toEqual(['start', 'end:finished']);
  });

  it('an error before the end still gives one end', async () => {
    const { seen, fireState, fireError } = await renderLoads();
    await fireState(state(true));
    await fireError({
      kind: 'network',
      url: 'https://x.invalid/',
      code: -1003,
      description: 'dns',
    });
    await fireState(state(false, 'failed'));
    expect(seen).toEqual(['start', 'error:network', 'end:failed']);
  });

  it('reports an HTTP status as an http error with its status code, without a description', async () => {
    const onError = jest.fn();
    const { native } = await render({ onError });
    await act(async () =>
      (native as { onError: (event: unknown) => void }).onError({
        nativeEvent: {
          kind: 'http',
          url: 'https://example.com/x',
          code: 404,
          description: 'Not Found',
        },
      })
    );
    expect(onError).toHaveBeenCalledWith({
      kind: 'http',
      url: 'https://example.com/x',
      statusCode: 404,
    });
  });

  it('reports a failed load as it came', async () => {
    const onError = jest.fn();
    const { native } = await render({ onError });
    const failure = {
      kind: 'network',
      url: 'https://example.com/',
      code: -1009,
      description: 'offline',
    };
    await act(async () =>
      (native as { onError: (event: unknown) => void }).onError({ nativeEvent: failure })
    );
    expect(onError).toHaveBeenCalledWith(failure);
  });
});

describe('hookOptions', () => {
  const nativeOf = (root: ReturnType<typeof createRoot>) =>
    root.container.queryAll((node) => node.type === 'MinimalWebView')[0]?.props;

  it('a change reaches the same native view: native passes it to the hooks live', async () => {
    const root = createRoot();
    const show = (hookOptions: Record<string, unknown>) =>
      act(async () =>
        root.render(<WebView source={{ uri: 'https://example.com' }} hookOptions={hookOptions} />)
      );
    mockMount.mockClear();
    await show({ sample: { mode: 'a' }, other: 1 });
    await show({ sample: { mode: 'b' }, other: 1 });
    expect(mockMount).toHaveBeenCalledTimes(1);
    expect(nativeOf(root)?.hookOptions).toEqual({ sample: { mode: 'b' }, other: 1 });
  });

  it('null and undefined values are not sent: the key is off, or removed', async () => {
    const root = createRoot();
    await act(async () =>
      root.render(
        <WebView
          source={{ uri: 'https://example.com' }}
          hookOptions={{ on: true, off: false, gone: null, unset: undefined }}
        />
      )
    );
    expect(nativeOf(root)?.hookOptions).toEqual({ on: true, off: false });
    expect(Object.keys(nativeOf(root)?.hookOptions as object)).toEqual(['on', 'off']);
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
  expect((await render({ ref: null })).native).toBeDefined();
});

describe('bridge', () => {
  const page = 'https://example.com';
  const newBridge = () => createBridge({ allowedOrigins: [page] });
  const onBridge = (native: object | undefined, nativeEvent: object) =>
    act(async () =>
      (native as { onBridge: (event: { nativeEvent: object }) => void }).onBridge({ nativeEvent })
    );
  const posted = () => JSON.parse(mockBridgePost.mock.lastCall?.[0] ?? '') as unknown;

  it("gives native the page client and origins, and answers a page's call with its origin", async () => {
    const bridge = newBridge();
    bridge.handle('who', (_, sender) => sender.origin);
    const { native } = await render({ bridge });
    expect(native).toMatchObject({
      bridgeScript: bridge[CONNECTION].script,
      bridgeOrigins: [page],
    });
    const call = { doc: 'd1', kind: 'call', id: 'p1', method: 'who' };
    await onBridge(native, { message: JSON.stringify(call), origin: `${page}:8443` });
    expect(posted()).toEqual({ doc: 'd1', kind: 'result', id: 'p1', value: `${page}:8443` });
  });

  it('passes navigated and unavailable on to the bridge', async () => {
    const bridge = newBridge();
    const { native } = await render({ bridge });
    await onBridge(native, { message: JSON.stringify({ doc: 'd1', kind: 'ready' }), origin: page });
    const sent = bridge.call('x');
    await onBridge(native, { navigated: true });
    await expect(sent).rejects.toMatchObject({ code: 'navigated' });
    await onBridge(native, { unavailable: true });
    await expect(bridge.call('x')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('detaches at unmount, so the bridge can go in the next WebView', async () => {
    const bridge = newBridge();
    const root = createRoot();
    await act(async () => root.render(<WebView source={{ uri: page }} bridge={bridge} />));
    const pending = bridge.call('x');
    await act(async () => root.unmount());
    await expect(pending).rejects.toMatchObject({ code: 'navigated' });
    await render({ bridge });
  });

  it('recreates the native view for another bridge, not for the same one', async () => {
    const root = createRoot();
    const show = (bridge: Bridge) =>
      act(async () => root.render(<WebView source={{ uri: page }} bridge={bridge} />));
    const bridge = newBridge();
    mockMount.mockClear();
    await show(bridge);
    await show(bridge);
    expect(mockMount).toHaveBeenCalledTimes(1);
    await show(newBridge());
    expect(mockMount).toHaveBeenCalledTimes(2);
  });
});

describe('ref.hook', () => {
  it('sends the arguments as JSON and parses the reply', async () => {
    const ref = createRef<WebViewRef>();
    await act(async () =>
      createRoot().render(<WebView ref={ref} source={{ uri: 'https://example.com' }} />)
    );
    expect(await ref.current?.hook('sample', 'count', [1, null])).toEqual({
      name: 'sample',
      method: 'count',
      args: '[1,null]',
    });
    expect(await ref.current?.hook('sample', 'count')).toMatchObject({ args: '[]' });
  });
});

describe('platform settings', () => {
  const settingsOf = async (props: Partial<WebViewProps>) =>
    JSON.parse((await render(props)).native?.settings as string) as Record<
      string,
      Record<string, unknown>
    >;

  it('are the defaults alone without props (jest runs as iOS)', async () => {
    expect(await settingsOf({})).toEqual({
      configuration: { allowsInlineMediaPlayback: true },
      webView: { customUserAgent: null, inspectable: true },
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
      scrollView: { bounces: false },
    });
  });

  it('send a root’s other keys among its own, a generated key winning', async () => {
    // The types refuse a generated key under other; JavaScript can still send one.
    const other: Record<string, SettingValue> = { nope: 1, bounces: true };
    const settings = await settingsOf({ ios: { scrollView: { bounces: false, other } } });
    expect(settings.scrollView).toEqual({ nope: 1, bounces: false });
  });

  type Configuration = NonNullable<WebViewProps['ios']>['configuration'];
  /** Renders one ios.configuration, then another, counting the native mounts. */
  const changeConfiguration = async (
    first: Configuration = { applicationNameForUserAgent: 'App/1' },
    second: Configuration = { applicationNameForUserAgent: 'App/2' }
  ) => {
    const root = createRoot();
    const show = (configuration: Configuration) =>
      act(async () =>
        root.render(<WebView source={{ uri: 'https://example.com' }} ios={{ configuration }} />)
      );
    mockMount.mockClear();
    await show(first);
    await show(second);
    return root;
  };

  it('recreate the native view for a changed configuration key, with the new settings', async () => {
    const root = await changeConfiguration();
    expect(mockMount).toHaveBeenCalledTimes(2);
    const native = root.container.queryAll((node) => node.type === 'MinimalWebView')[0]?.props as {
      settings: string;
    };
    const settings = JSON.parse(native.settings) as { configuration: Record<string, unknown> };
    expect(settings.configuration.applicationNameForUserAgent).toBe('App/2');
  });

  it('keep the native view when only the key order of the configuration changes', async () => {
    await changeConfiguration(
      { applicationNameForUserAgent: 'App/1', limitsNavigationsToAppBoundDomains: true },
      { limitsNavigationsToAppBoundDomains: true, applicationNameForUserAgent: 'App/1' }
    );
    expect(mockMount).toHaveBeenCalledTimes(1);
  });

  describe('on Android', () => {
    beforeEach(() => jest.replaceProperty(Platform, 'OS', 'android'));
    afterEach(() => jest.restoreAllMocks());

    it('are the defaults alone without props', async () => {
      expect(await settingsOf({})).toEqual({
        settings: { userAgentString: null },
        webView: {},
      });
    });

    it('put userAgent over the app keys, and the app keys over the defaults', async () => {
      const settings = await settingsOf({
        userAgent: 'Agent/1',
        android: {
          settings: { userAgentString: 'Overridden/0', textZoom: 120 },
          webView: { overScrollMode: 2 },
        },
        ios: { webView: { inspectable: false } },
      });
      expect(settings).toEqual({
        settings: { userAgentString: 'Agent/1', textZoom: 120 },
        webView: { overScrollMode: 2 },
      });
    });

    it('keep the native view when an ios.configuration key changes', async () => {
      await changeConfiguration();
      expect(mockMount).toHaveBeenCalledTimes(1);
    });
  });

  it('logs native warnings', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const root = createRoot();
    await act(async () => root.render(<WebView source={{ uri: 'https://example.com' }} />));
    const native = root.container.queryAll((node) => node.type === 'MinimalWebView')[0]?.props as {
      onHookEvent: (event: { nativeEvent: Record<string, unknown> }) => Promise<void>;
    };
    await act(() =>
      native.onHookEvent({
        nativeEvent: {
          name: 'core.warning',
          payload: { message: 'ios.scrollView.nope: no such property' },
        },
      })
    );
    expect(warn).toHaveBeenCalledWith('[minimal-rn-webview] ios.scrollView.nope: no such property');
    expect(mockAnswer).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('page requests', () => {
  type Fire = (event: string, payload: Record<string, unknown>, askId?: number) => Promise<void>;

  async function renderRequests(props: Partial<WebViewProps>) {
    const root = createRoot();
    const show = (next: Partial<WebViewProps>) =>
      act(async () => root.render(<WebView source={{ uri: 'https://example.com' }} {...next} />));
    await show(props);
    const native = () =>
      root.container.queryAll((node) => node.type === 'MinimalWebView')[0]?.props as {
        requestHandlers: string[];
        onHookEvent: (event: { nativeEvent: Record<string, unknown> }) => Promise<void>;
      };
    const fire: Fire = (name, payload, askId) =>
      act(() => native().onHookEvent({ nativeEvent: { name, payload, askId } }));
    return { root, show, native, fire };
  }

  beforeEach(() => mockAnswer.mockClear());

  it('tells native which requests have a prop, as the same array until that set changes', async () => {
    const { show, native } = await renderRequests({ onDownload: () => {} });
    const first = native().requestHandlers;
    expect(first).toEqual(['download']);
    await show({ onDownload: () => {} });
    expect(native().requestHandlers).toBe(first);
    await show({ onDownload: () => {}, onPermissionRequest: () => true });
    expect(native().requestHandlers).toEqual(['permissionRequest', 'download']);
    await show({});
    expect(native().requestHandlers).toEqual([]);
  });

  it('routes each request to its prop and answers with its result', async () => {
    const onFileRequest = jest.fn(async () => ['file:///a.txt']);
    const onFullscreenChange = jest.fn();
    const onDownload = jest.fn();
    const { fire } = await renderRequests({ onFileRequest, onFullscreenChange, onDownload });
    await fire('core.fileRequest', { accept: [], multiple: false, capture: false }, 1);
    expect(onFileRequest).toHaveBeenCalledWith(
      { accept: [], multiple: false, capture: false },
      expect.any(AbortSignal)
    );
    expect(mockAnswer).toHaveBeenCalledWith(1, { value: ['file:///a.txt'] });
    await fire('core.fullscreenChange', { active: true });
    expect(onFullscreenChange).toHaveBeenCalledWith({ active: true }, undefined);
    const failure = {
      ok: false,
      kind: 'http',
      filename: 'a.txt',
      url: 'https://a.test/a',
      statusCode: 404,
    };
    await fire('core.download', failure);
    expect(onDownload).toHaveBeenCalledWith(failure, undefined);
    expect(mockAnswer).toHaveBeenCalledTimes(1);
  });

  it('answers block to a navigation request when the prop throws or returns nothing', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onNavigationRequest = jest
      .fn()
      .mockResolvedValueOnce('allow')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('no'));
    const { fire, native } = await renderRequests({
      onNavigationRequest,
      onOpenExternal: () => true,
    });
    expect(native().requestHandlers).toEqual(['navigationRequest', 'openExternal']);
    const request = {
      url: 'https://a.example',
      mainFrame: true,
      newWindow: false,
      userInitiated: true,
    };
    await fire('core.navigationRequest', request, 1);
    expect(onNavigationRequest).toHaveBeenCalledWith(request, expect.any(AbortSignal));
    expect(mockAnswer).toHaveBeenLastCalledWith(1, { value: 'allow' });
    await fire('core.navigationRequest', request, 2);
    expect(mockAnswer).toHaveBeenLastCalledWith(2, { value: null });
    await fire('core.navigationRequest', request, 3);
    expect(mockAnswer).toHaveBeenLastCalledWith(3, { value: 'block' });
    error.mockRestore();
  });

  it('answers null when the prop is gone or throws, and routes other names to onHookEvent', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onHookEvent = jest.fn(({ name }: { name: string }) => `${name}!`);
    const { fire } = await renderRequests({
      onPermissionRequest: () => {
        throw new Error('no');
      },
      onHookEvent,
    });
    await fire(
      'core.permissionRequest',
      { origin: 'https://example.com', resources: ['camera'] },
      2
    );
    expect(mockAnswer).toHaveBeenLastCalledWith(2, { value: null });
    expect(error).toHaveBeenCalledWith(
      '[minimal-rn-webview] onPermissionRequest failed',
      expect.any(Error)
    );
    await fire('core.fileRequest', { accept: [], multiple: false, capture: false }, 3);
    expect(mockAnswer).toHaveBeenLastCalledWith(3, { value: null });
    expect(onHookEvent).not.toHaveBeenCalled();
    await fire('pageCounter.pick', { a: 1 }, 4);
    expect(onHookEvent).toHaveBeenCalledWith(
      { name: 'pageCounter.pick', payload: { a: 1 } },
      expect.any(AbortSignal)
    );
    expect(mockAnswer).toHaveBeenLastCalledWith(4, { value: 'pageCounter.pick!' });
    await fire('pageCounter.note', { b: 2 });
    expect(onHookEvent).toHaveBeenLastCalledWith(
      { name: 'pageCounter.note', payload: { b: 2 } },
      undefined
    );
    expect(mockAnswer).toHaveBeenCalledTimes(3);
    error.mockRestore();
  });

  it('aborts the signal of an ask native cancels, and drops its late answer', async () => {
    let release = (_: boolean) => {};
    let signal: AbortSignal | undefined;
    const { fire } = await renderRequests({
      onPermissionRequest: (_, s) => {
        signal = s;
        return new Promise<boolean>((resolve) => (release = resolve));
      },
    });
    const asked = fire('core.permissionRequest', { origin: 'https://a.example', resources: [] }, 5);
    await fire('core.askCancelled', { askId: 6 });
    expect(signal?.aborted).toBe(false);
    await fire('core.askCancelled', { askId: 5 });
    expect(signal?.aborted).toBe(true);
    release(true);
    await asked;
    expect(mockAnswer).not.toHaveBeenCalled();
  });

  it('aborts the asks in flight at unmount, not the answered ones', async () => {
    const signals: AbortSignal[] = [];
    const { root, native, fire } = await renderRequests({
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
      nativeEvent: { name: 'core.permissionRequest', payload: {}, askId: 1 },
    });
    await fire('core.fileRequest', { accept: [], multiple: false, capture: false }, 2);
    await act(async () => root.unmount());
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    await asked;
  });

  it('asks onOpenExternal with the request and answers its result; a throw answers null, which opens nothing', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onOpenExternal = jest
      .fn<boolean | Promise<boolean>, [NavigationRequest, AbortSignal]>()
      .mockReturnValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => {
        throw new Error('no');
      });
    const { fire } = await renderRequests({ onOpenExternal });
    const request = (url: string) => ({
      url,
      mainFrame: true,
      newWindow: false,
      userInitiated: true,
    });
    await fire('core.openExternal', request('intent://a#Intent;end'), 1);
    expect(mockAnswer).toHaveBeenLastCalledWith(1, { value: false });
    await fire('core.openExternal', request('tel:1'), 2);
    expect(mockAnswer).toHaveBeenLastCalledWith(2, { value: true });
    await fire('core.openExternal', request('tel:2'), 3);
    // Native counts anything but false as opened by the app, so null opens nothing.
    expect(mockAnswer).toHaveBeenLastCalledWith(3, { value: null });
    expect(error).toHaveBeenCalledWith(
      '[minimal-rn-webview] onOpenExternal failed',
      expect.any(Error)
    );
    const signal: unknown = expect.any(AbortSignal);
    expect(onOpenExternal.mock.calls).toEqual(
      ['intent://a#Intent;end', 'tel:1', 'tel:2'].map((url) => [request(url), signal])
    );
    error.mockRestore();
  });
});

describe('navigation state across remounts', () => {
  const at = (url: string): NavigationState => ({
    url,
    pendingUrl: null,
    title: '',
    loading: false,
    progress: 0,
    canGoBack: false,
    canGoForward: false,
    outcome: null,
  });
  const fireState = (root: ReturnType<typeof createRoot>, state: NavigationState, index = 0) =>
    act(async () => {
      const native = root.container.queryAll((node) => node.type === 'MinimalWebView')[index];
      (
        native?.props as { onNavigationState: (event: { nativeEvent: NavigationState }) => void }
      ).onNavigationState({ nativeEvent: state });
    });

  it("passes on the documented keys only, not React Native's own", async () => {
    const ref = createWebViewRef();
    const onNavigation = jest.fn();
    const onProcessGone = jest.fn();
    const root = createRoot();
    await act(async () =>
      root.render(
        <WebView
          ref={ref}
          source={{ uri: 'https://example.com' }}
          onNavigation={onNavigation}
          onProcessGone={onProcessGone}
        />
      )
    );
    const target = { target: 42 };
    await fireState(root, { ...at('https://example.com/a'), ...target } as NavigationState);
    expect(ref.getState()).toStrictEqual(at('https://example.com/a'));
    const native = root.container.queryAll((node) => node.type === 'MinimalWebView')[0]?.props as {
      onNavigation: (event: { nativeEvent: object }) => void;
      onProcessGone: (event: { nativeEvent: object }) => void;
    };
    const navigation = {
      url: 'https://example.com/b',
      mainFrame: true,
      newWindow: false,
      userInitiated: true,
      action: 'allow',
      rule: null,
    };
    await act(async () => {
      native.onNavigation({ nativeEvent: { ...navigation, ...target } });
      native.onProcessGone({ nativeEvent: { didCrash: true, recovered: true, ...target } });
    });
    expect(onNavigation).toHaveBeenCalledWith(navigation);
    expect(onProcessGone).toHaveBeenCalledWith({ didCrash: true, recovered: true });
  });

  it("createWebViewRef's current is the mounted WebView's ref, and null while none is", async () => {
    const ref = createWebViewRef();
    expect(ref.current).toBeNull();
    expect(await ref.current?.get('scrollView.bounces')).toBeUndefined();

    const root = createRoot();
    await act(async () =>
      root.render(<WebView ref={ref} source={{ uri: 'https://example.com' }} />)
    );
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
      completion: null,
    });
    expect(await ref.current?.call('clearCache')).toMatchObject({ args: '[]' });
    // The completion shape comes from the SDK headers' table; an unlisted selector gets none, so native rejects it.
    expect(await ref.current?.call('httpCookieStore.getAllCookies:')).toEqual({
      call: 'httpCookieStore.getAllCookies:',
      args: '[]',
      completion: 'value',
    });
    expect(
      await ref.current?.call('webView.restoreData:completionHandler:', [{ data: '' }])
    ).toMatchObject({ completion: 'error' });
    expect(await ref.current?.call('webView.x:completionHandler:')).toMatchObject({
      completion: null,
    });
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
    const root = createRoot();
    await act(async () =>
      root.render(<WebView ref={ref} source={{ uri: 'https://example.com' }} />)
    );

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
    const root = createRoot();
    await act(async () =>
      root.render(<WebView ref={ref} source={{ uri: 'https://example.com' }} />)
    );
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
    await fireState(root, at('https://example.com/a'));
    expect(ref.getState().url).toBe('https://example.com/a');
    listener.mockClear();

    await show(2); // remount
    expect(listener).toHaveBeenCalled();
    expect(ref.getState().url).toBe('');
    await fireState(root, at('https://example.com/b'));
    expect(ref.getState().url).toBe('https://example.com/b');

    listener.mockClear();
    await show(null);
    expect(listener).toHaveBeenCalled();
    expect(ref.getState()).toEqual(at(''));

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
    await fireState(root, at('https://example.com/a'));
    await show(two);
    expect(two.current).not.toBeNull();
    expect(two.getState().url).toBe('https://example.com/a');
    expect(one.current).toBeNull();
    expect(one.getState()).toEqual(at(''));
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
    await fireState(root, at('https://example.com/a'));
    expect(ref.getState().url).toBe('https://example.com/a');
    await show('b');
    expect(ref.current).not.toBeNull();
    expect(ref.getState()).toEqual(at(''));
    await fireState(root, at('https://example.com/b'));
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
    await fireState(root, at('https://example.com/second'), 1);
    await fireState(root, at('https://example.com/first'), 0);
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
      await fireState(root, at('https://example.com/a'));
      expect(shown()).toBe('https://example.com/a');
      await act(async () => remount());
      expect(shown()).toBe('');
      const before = renders;
      await fireState(root, at('https://example.com/b'));
      expect(shown()).toBe('https://example.com/b');
      expect(renders).toBeGreaterThan(before);
    }
  );
});
