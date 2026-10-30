import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

import {
  androidLayerType,
  basicAuthCredential,
  dialogs,
  hideKeyboardAccessoryView,
  menuItems,
  nestedScrollEnabled,
  onScroll,
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
    ['dialogs', dialogs(() => true), 'dialogs', true],
    ['menuItems', menuItems({ items: MENU, onSelect: () => {} }), 'menuItems', { items: MENU }],
    ['menuItems with suppress only', menuItems({ suppress: ['copy'] }), 'menuItems', { suppress: ['copy'] }],
    ['onScroll', onScroll(() => {}), 'onScroll', true],
    ['hideKeyboardAccessoryView', hideKeyboardAccessoryView(), 'hideKeyboardAccessoryView', true],
  ])('%s has its key and options on iOS', (_, extension, name, options) => {
    expect(plain(extension)).toEqual({ key: `${K}.${name}`, options });
  });

  it('gives the Android ones their key on Android, and null for the iOS ones and suppress alone', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    expect(plain(nestedScrollEnabled())).toEqual({ key: `${K}.nestedScrollEnabled`, options: true });
    expect(plain(androidLayerType('software'))).toEqual({
      key: `${K}.androidLayerType`,
      options: 'software',
    });
    expect(plain(menuItems({ items: MENU }))).toEqual({ key: `${K}.menuItems`, options: { items: MENU } });
    expect(hideKeyboardAccessoryView()).toBeNull();
    expect(menuItems({ suppress: ['copy'] })).toBeNull();
  });

  it('gives null for the Android ones on iOS, and for a menu with nothing in it', () => {
    expect(nestedScrollEnabled()).toBeNull();
    expect(androidLayerType('hardware')).toBeNull();
    expect(menuItems({ onSelect: () => {} })).toBeNull();
  });

  it("calls react-native-webview's callbacks with { nativeEvent }", () => {
    const scrolled = jest.fn();
    const scroll = { contentOffset: { x: 0, y: 400 } };
    onScroll(scrolled).onEvent!({ name: `${K}.onScroll.scroll`, payload: scroll });
    expect(scrolled).toHaveBeenCalledWith({ nativeEvent: scroll });
    const selected = jest.fn();
    const selection = { key: 'hl', label: 'Highlight', selectedText: 'word' };
    menuItems({ items: MENU, onSelect: selected })!.onEvent!({
      name: `${K}.menuItems.selection`,
      payload: selection,
    });
    expect(selected).toHaveBeenCalledWith({ nativeEvent: selection });
  });

  it('calls onDialog with the dialog and its type, and returns its answer', async () => {
    const onDialog = jest.fn(async () => 'typed');
    const signal = new AbortController().signal;
    const prompt = { message: 'name?', defaultValue: 'default', url: 'https://example.com/' };
    const answer = dialogs(onDialog).onEvent!({ name: `${K}.dialogs.prompt`, payload: prompt }, signal);
    await expect(answer).resolves.toBe('typed');
    expect(onDialog).toHaveBeenCalledWith({ ...prompt, type: 'prompt' }, signal);
  });
});
