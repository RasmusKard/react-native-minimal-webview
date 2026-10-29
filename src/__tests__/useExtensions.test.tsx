import { act } from 'react';
import { createRoot } from 'test-renderer';

import type { HookExtension } from '../types';
import { useExtensions } from '../useExtensions';

type Args = Parameters<typeof useExtensions>;

/** Renders useExtensions with `args`, and again with each `render(...)`; `result` is the latest return value. */
async function mount(...args: Args) {
  const root = createRoot();
  let result!: ReturnType<typeof useExtensions>;
  function Probe({ args: [extensions, props] }: { args: Args }) {
    result = useExtensions(extensions, props);
    return null;
  }
  const render = async (...next: Args) => await act(async () => root.render(<Probe args={next} />));
  await render(...args);
  return { render, result: () => result };
}

const ext = (key: string, options: unknown, onEvent?: HookExtension['onEvent']): HookExtension => ({
  key,
  options,
  onEvent,
});

describe('useExtensions', () => {
  it("merges the extensions' options over the app's hookOptions, a later extension winning", async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result, render } = await mount([ext('a', 1), ext('b', { x: [1] }), ext('a', 2)], {
      hookOptions: { b: 'mine', c: true },
    });
    expect(result().hookOptions).toEqual({ a: 2, b: { x: [1] }, c: true });
    await render([ext('a', 1), ext('b', true), ext('a', 3)]);
    expect(warn.mock.calls).toEqual([
      ['[minimal-rn-webview] useExtensions: two extensions have the key a; the later one wins'],
    ]);
    warn.mockRestore();
  });

  it('routes each event to the extension its name starts with, the longest key first, and returns its answer', async () => {
    const short = jest.fn(() => 'short');
    const long = jest.fn(async () => 'long');
    const app = jest.fn();
    const { result } = await mount([ext('pkg', true, short), ext('pkg.dialogs', true, long)], {
      onHookEvent: app,
    });
    const signal = new AbortController().signal;
    const ask = { name: 'pkg.dialogs.prompt', payload: { message: 'name?' } };
    await expect(result().onHookEvent(ask, signal)).resolves.toBe('long');
    expect(long).toHaveBeenCalledWith(ask, signal);
    const emit = { name: 'pkg.scroll', payload: {} };
    expect(result().onHookEvent(emit)).toBe('short');
    expect(short).toHaveBeenCalledWith(emit, undefined);
    expect(app).not.toHaveBeenCalled();
  });

  it("gives the app's onHookEvent every event no extension's onEvent takes", async () => {
    const app = jest.fn(() => 'app');
    const own = jest.fn();
    const { result } = await mount([ext('a', true, own), ext('quiet', true)], { onHookEvent: app });
    const signal = new AbortController().signal;
    for (const name of ['other.label', 'quiet.event', 'ab.event', 'a']) {
      const event = { name, payload: {} };
      expect(result().onHookEvent(event, signal)).toBe('app');
      expect(app).toHaveBeenLastCalledWith(event, signal);
    }
    expect(own).not.toHaveBeenCalled();
    expect((await mount([ext('a', true)])).result().onHookEvent({ name: 'a.b', payload: {} })).toBe(
      undefined
    );
  });

  it('leaves out falsy entries, so a switched-off key leaves hookOptions and its events go to the app', async () => {
    const own = jest.fn();
    const app = jest.fn();
    const { render, result } = await mount([ext('a', true, own), ext('b', 1)], {
      onHookEvent: app,
    });
    for (const off of [false, null, undefined] as const) {
      await render([off, ext('b', 1)], { onHookEvent: app });
      expect(result().hookOptions).toEqual({ b: 1 });
    }
    result().onHookEvent({ name: 'a.ask', payload: {} });
    expect(own).not.toHaveBeenCalled();
    expect(app).toHaveBeenCalledTimes(1);
  });

  it('returns the same object while the options are the same JSON, with the latest handlers taking the events', async () => {
    const { render, result } = await mount([ext('a', { items: [1] }, () => 'first')], {
      hookOptions: { b: true },
    });
    const first = result();
    await render([ext('a', { items: [1] }, () => 'second')], { hookOptions: { b: true } });
    expect(result()).toBe(first);
    expect(first.onHookEvent({ name: 'a.x', payload: {} })).toBe('second');
    await render([ext('a', { items: [2] })], { hookOptions: { b: true } });
    expect(result()).not.toBe(first);
    expect(result().hookOptions).toEqual({ a: { items: [2] }, b: true });
    expect(result().onHookEvent).toBe(first.onHookEvent);
  });
});
