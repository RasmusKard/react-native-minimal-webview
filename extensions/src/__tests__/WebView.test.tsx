import type { WebViewProps as CoreWebViewProps } from 'minimal-rn-webview';
import { act } from 'react';
import { Platform } from 'react-native';
import { createRoot } from 'test-renderer';

import { WebView } from '../WebView';
import type { WebViewProps } from '../types';

const mockCore = jest.fn<null, [CoreWebViewProps]>(() => null);
jest.mock('minimal-rn-webview', () => ({ WebView: (props: CoreWebViewProps) => mockCore(props) }), {
  virtual: true,
});

const K = '@minimal-rn-webview/extensions';
const source = { uri: 'https://example.com' };

async function render(props: Partial<WebViewProps>) {
  mockCore.mockClear();
  await act(async () => createRoot().render(<WebView source={source} {...props} />));
  return mockCore.mock.lastCall![0];
}

describe('WebView', () => {
  afterEach(() => jest.restoreAllMocks());

  it('passes the core props and your hookOptions through as they are when no extension prop is set', async () => {
    const hookOptions = { 'sample.pageCounter': true };
    const core = await render({ hookOptions, testID: 'web', pullToRefresh: true });
    expect(core.hookOptions).toBe(hookOptions);
    expect(core).toMatchObject({ source, testID: 'web', pullToRefresh: true });
    expect(await render({})).toHaveProperty('hookOptions', undefined);
  });

  it.each<[string, Partial<WebViewProps>, string, unknown]>([
    [
      'basicAuthCredential',
      { basicAuthCredential: { username: 'u', password: 'p' } },
      'basicAuthCredential',
      { username: 'u', password: 'p' },
    ],
    ['onDialog', { onDialog: () => true }, 'dialogs', true],
    [
      'menuItems',
      { menuItems: [{ label: 'Highlight', key: 'hl' }] },
      'menuItems',
      { items: [{ label: 'Highlight', key: 'hl' }] },
    ],
    ['suppressMenuItems', { suppressMenuItems: ['copy'] }, 'menuItems', { suppress: ['copy'] }],
    ['onScroll', { onScroll: () => {} }, 'onScroll', true],
    ['hideKeyboardAccessoryView', { hideKeyboardAccessoryView: true }, 'hideKeyboardAccessoryView', true],
  ])('turns on its key for %s (iOS), and only that one', async (_, props, name, value) => {
    const { hookOptions } = await render(props);
    expect(hookOptions).toEqual({ [`${K}.${name}`]: value });
  });

  it.each<[string, Partial<WebViewProps>, string, unknown]>([
    ['nestedScrollEnabled', { nestedScrollEnabled: true }, 'nestedScrollEnabled', true],
    ['androidLayerType', { androidLayerType: 'software' }, 'androidLayerType', 'software'],
    [
      'menuItems',
      { menuItems: [{ label: 'Highlight', key: 'hl' }] },
      'menuItems',
      { items: [{ label: 'Highlight', key: 'hl' }] },
    ],
  ])('turns on its key for %s (Android)', async (_, props, name, value) => {
    jest.replaceProperty(Platform, 'OS', 'android');
    expect((await render(props)).hookOptions).toEqual({ [`${K}.${name}`]: value });
  });

  it("sends no key for a prop that is off, or another platform's", async () => {
    const off = await render({
      hideKeyboardAccessoryView: false,
      nestedScrollEnabled: true,
      androidLayerType: 'hardware',
    });
    expect(off.hookOptions).toBeUndefined();
    jest.replaceProperty(Platform, 'OS', 'android');
    const ios = await render({
      hideKeyboardAccessoryView: true,
      suppressMenuItems: ['copy'],
      nestedScrollEnabled: false,
    });
    expect(ios.hookOptions).toBeUndefined();
  });

  it('keeps your hookOptions beside its own keys, and never passes its props to the core', async () => {
    const core = await render({
      hookOptions: { 'sample.pageCounter': true },
      onScroll: () => {},
      basicAuthCredential: { username: 'u', password: 'p' },
    });
    expect(core.hookOptions).toEqual({
      'sample.pageCounter': true,
      [`${K}.onScroll`]: true,
      [`${K}.basicAuthCredential`]: { username: 'u', password: 'p' },
    });
    expect(core).not.toHaveProperty('onScroll');
    expect(core).not.toHaveProperty('basicAuthCredential');
  });

  it('calls each prop with its event, react-native-webview callbacks with { nativeEvent }', async () => {
    const onScroll = jest.fn();
    const onCustomMenuSelection = jest.fn();
    const onDialog = jest.fn(async () => 'typed');
    const onHookEvent = jest.fn();
    const core = await render({
      onScroll,
      onCustomMenuSelection,
      onDialog,
      onHookEvent,
      menuItems: [{ label: 'Highlight', key: 'hl' }],
    });
    const scroll = { contentOffset: { x: 0, y: 400 } };
    core.onHookEvent!({ name: `${K}.onScroll.scroll`, payload: scroll });
    expect(onScroll).toHaveBeenCalledWith({ nativeEvent: scroll });
    const selection = { key: 'hl', label: 'Highlight', selectedText: 'word' };
    core.onHookEvent!({ name: `${K}.menuItems.selection`, payload: selection });
    expect(onCustomMenuSelection).toHaveBeenCalledWith({ nativeEvent: selection });
    const signal = new AbortController().signal;
    const prompt = { message: 'name?', defaultValue: 'default', url: 'https://example.com/' };
    const answer = core.onHookEvent!({ name: `${K}.dialogs.prompt`, payload: prompt }, signal);
    await expect(answer).resolves.toBe('typed');
    expect(onDialog).toHaveBeenCalledWith({ ...prompt, type: 'prompt' }, signal);
    expect(onHookEvent).not.toHaveBeenCalled();
  });

  it("passes your onHookEvent every event no prop takes, with the signal, and returns its answer", async () => {
    const onHookEvent = jest.fn(() => 'answer');
    const core = await render({ onHookEvent, onScroll: () => {} });
    const signal = new AbortController().signal;
    const events = [
      { name: 'sample.pageCounter.label', payload: { count: 1 } },
      // An extension's event whose prop is gone (a dialog asked before onDialog was removed).
      { name: `${K}.dialogs.confirm`, payload: { message: 'ok?' } },
    ];
    for (const event of events) {
      expect(core.onHookEvent!(event, signal)).toBe('answer');
      expect(onHookEvent).toHaveBeenLastCalledWith(event, signal);
    }
  });
});
