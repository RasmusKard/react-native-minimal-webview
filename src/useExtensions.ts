import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import type { HookEvent, HookExtension, WebViewProps } from './types';

/**
 * The `hookOptions` and `onHookEvent` props that turn on the hooks of `extensions`, to spread onto the `WebView`.
 *
 * `hookOptions` has each extension's `options` under its `key`, on top of `props.hookOptions`: an extension wins over
 * a key of yours, and a later extension over an earlier one with the same key, which warns in development. Each event
 * goes to the `onEvent` of the extension whose key its name starts with (`'<key>.'`; the longest key, when several do),
 * and to `props.onHookEvent` when there is none or that extension has no `onEvent`. The handler's return value answers
 * an ask.
 *
 * A false, null or undefined entry is left out, so `on && extension(…)` switches one on and off: its key leaves
 * `hookOptions`. The result is the same object while the options are the same JSON, so a render with new handlers sends
 * native nothing; the latest handlers always take the events.
 * @see [Native hooks example](../guides/examples.md#native-hooks)
 * @group Native hooks
 */
export function useExtensions(
  extensions: readonly (HookExtension | false | null | undefined)[],
  props: Pick<WebViewProps, 'hookOptions' | 'onHookEvent'> = {}
): Required<Pick<WebViewProps, 'hookOptions' | 'onHookEvent'>> {
  const on = extensions.filter((extension): extension is HookExtension => !!extension);
  const keys = on.map(({ key }) => key);
  const repeated = JSON.stringify([...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))]);
  useEffect(() => {
    if (!__DEV__) return;
    for (const key of JSON.parse(repeated) as string[])
      console.warn(
        `[minimal-rn-webview] useExtensions: two extensions have the key ${key}; the later one wins`
      );
  }, [repeated]);
  const latest = useRef({ on, props });
  useLayoutEffect(() => {
    latest.current = { on, props };
  });
  const json = JSON.stringify({
    ...props.hookOptions,
    ...Object.fromEntries(on.map(({ key, options }) => [key, options])),
  });
  const hookOptions = useMemo(() => JSON.parse(json) as Record<string, unknown>, [json]);
  const onHookEvent = useCallback((event: HookEvent, signal?: AbortSignal) => {
    const { on: current, props: app } = latest.current;
    const byKey = new Map(current.map((extension) => [extension.key, extension]));
    const { name } = event;
    let owner: HookExtension | undefined;
    for (let end = name.lastIndexOf('.'); end > 0 && !owner; end = name.lastIndexOf('.', end - 1))
      owner = byKey.get(name.slice(0, end));
    return (owner?.onEvent ?? app.onHookEvent)?.(event, signal);
  }, []);
  return useMemo(() => ({ hookOptions, onHookEvent }), [hookOptions, onHookEvent]);
}
