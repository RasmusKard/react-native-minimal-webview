import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

import {
  androidLayerType,
  basicAuthCredential,
  type Dialog,
  dialogs,
  downloadManager,
  hideKeyboardAccessoryView,
  incognito,
  keyboardDisplayRequiresUserAction,
  menuItems,
  nestedScrollEnabled,
  onLoadSubResourceError,
  onScroll,
  refreshControlLightMode,
  removeIosKeyboardObserver,
  transparentBackground,
} from '..';

const K = '@react-native-minimal-webview/extensions';
const MENU = [{ label: 'Highlight', key: 'hl' }];

/** The descriptor without its handler, which `toEqual` can't compare. */
const plain = (extension: HookExtension | null) =>
  extension && { key: extension.key, options: extension.options };

describe('the extensions', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each<[string, HookExtension | null, string, unknown]>([
    ['basicAuthCredential', basicAuthCredential({ username: 'u', password: 'p' }), 'basicAuthCredential', { username: 'u', password: 'p' }],
    ['dialogs', dialogs(() => true), 'dialogs', undefined],
    ['incognito', incognito(), 'incognito', undefined],
    ['menuItems', menuItems({ items: MENU, onSelect: () => {} }), 'menuItems', { items: MENU }],
    ['menuItems with suppress only', menuItems({ suppress: ['copy'] }), 'menuItems', { suppress: ['copy'] }],
    ['onScroll', onScroll(() => {}), 'onScroll', undefined],
    ['transparentBackground', transparentBackground(), 'transparentBackground', undefined],
    ['hideKeyboardAccessoryView', hideKeyboardAccessoryView(), 'hideKeyboardAccessoryView', undefined],
    ['keyboardDisplayRequiresUserAction', keyboardDisplayRequiresUserAction(false), 'keyboardDisplayRequiresUserAction', undefined],
    ['refreshControlLightMode', refreshControlLightMode(), 'refreshControlLightMode', undefined],
    ['removeIosKeyboardObserver', removeIosKeyboardObserver(), 'removeIosKeyboardObserver', undefined],
  ])('%s has its key and options on iOS (none: the default, true)', (_, extension, name, options) => {
    expect(plain(extension)).toEqual({ key: `${K}.${name}`, options });
  });

  it('gives the Android ones their key on Android, and null for the iOS ones and suppress alone', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    expect(plain(nestedScrollEnabled())).toEqual({ key: `${K}.nestedScrollEnabled` });
    expect(plain(androidLayerType('software'))).toEqual({
      key: `${K}.androidLayerType`,
      options: 'software',
    });
    expect(plain(menuItems({ items: MENU }))).toEqual({ key: `${K}.menuItems`, options: { items: MENU } });
    expect(plain(transparentBackground())).toEqual({ key: `${K}.transparentBackground` });
    expect(plain(incognito())).toEqual({ key: `${K}.incognito` });
    expect(plain(downloadManager())).toEqual({ key: `${K}.downloadManager` });
    expect(plain(downloadManager({ downloadingMessage: 'Saving' }))).toEqual({
      key: `${K}.downloadManager`,
      options: { downloadingMessage: 'Saving' },
    });
    expect(plain(onLoadSubResourceError(() => {}))).toEqual({ key: `${K}.onLoadSubResourceError` });
    expect(hideKeyboardAccessoryView()).toBeNull();
    expect(keyboardDisplayRequiresUserAction(false)).toBeNull();
    expect(refreshControlLightMode()).toBeNull();
    expect(removeIosKeyboardObserver()).toBeNull();
    expect(menuItems({ suppress: ['copy'] })).toBeNull();
  });

  it("gives null for the Android ones on iOS, for a menu with nothing in it, and for WebKit's keyboard default", () => {
    expect(nestedScrollEnabled()).toBeNull();
    expect(androidLayerType('hardware')).toBeNull();
    expect(downloadManager()).toBeNull();
    expect(onLoadSubResourceError(() => {})).toBeNull();
    expect(menuItems({ onSelect: () => {} })).toBeNull();
    expect(keyboardDisplayRequiresUserAction(true)).toBeNull();
  });

  it('calls onScroll and onSelect with the event as it came', () => {
    const scrolled = jest.fn();
    const scroll = {
      contentOffset: { x: 0, y: 400 },
      contentInset: { top: 0, left: 0, bottom: 0, right: 0 },
      contentSize: { width: 400, height: 2000 },
      layoutMeasurement: { width: 400, height: 800 },
    };
    onScroll(scrolled).onEvent!({ name: 'scroll', payload: scroll });
    expect(scrolled).toHaveBeenCalledWith(scroll);
    const selected = jest.fn();
    const selection = { key: 'hl', label: 'Highlight', selectedText: 'word' };
    menuItems({ items: MENU, onSelect: selected })!.onEvent!({
      name: 'selection',
      payload: selection,
    });
    expect(selected).toHaveBeenCalledWith(selection);
  });

  it('calls onLoadSubResourceError with the event as it came', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const failed = jest.fn();
    const error = { url: 'http://127.0.0.1:1/x.png', code: -6, description: 'net::ERR_CONNECTION_REFUSED' };
    onLoadSubResourceError(failed)!.onEvent!({ name: 'error', payload: error });
    expect(failed).toHaveBeenCalledWith(error);
  });

  it('calls onDialog with the dialog as it came, and returns its answer', async () => {
    const onDialog = jest.fn(async () => 'typed');
    const signal = new AbortController().signal;
    const prompt: Dialog = {
      type: 'prompt',
      message: 'name?',
      defaultValue: 'default',
      url: 'https://example.com/',
      mainFrame: true,
    };
    const answer = dialogs(onDialog).onEvent!({ name: 'prompt', payload: prompt }, signal);
    await expect(answer).resolves.toBe('typed');
    expect(onDialog).toHaveBeenCalledWith(prompt, signal);
  });

  it.each<[Dialog['type'], unknown, unknown]>([
    ['confirm', true, true],
    ['confirm', 1, false],
    ['confirm', 'yes', false],
    ['confirm', undefined, false],
    ['prompt', '', ''],
    ['prompt', 1, null],
    ['prompt', true, null],
    ['prompt', undefined, null],
  ])('answers a %s whose onDialog returns %p with %p', async (type, returned, answer) => {
    const event = { name: type, payload: { type, message: '', defaultValue: null, url: '' } as Dialog };
    const signal = new AbortController().signal;
    await expect(dialogs(() => returned).onEvent!(event, signal)).resolves.toBe(answer);
  });

  it('rejects when onDialog throws, which the core answers with null', async () => {
    const event = { name: 'confirm' as const, payload: { type: 'confirm', message: '', url: '' } as Dialog };
    const failing = dialogs(() => {
      throw new Error('no');
    });
    await expect(failing.onEvent!(event, new AbortController().signal)).rejects.toThrow('no');
  });
});
