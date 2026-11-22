import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import {
  errorCode,
  fresh,
  idle,
  recreate,
  text,
  until,
  waitForLoad,
  happens,
} from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';

export async function sources(h: Harness, r: Reporter) {
  const body = `amount=9.99&t=${Date.now()}`;
  for (const [form, host] of [
    ['', 'localhost'],
    [' when the source URL has an uppercase host', 'LOCALHOST'],
  ]) {
    const post = fresh(h, '/post');
    await waitForLoad(
      h,
      () => h.loadSource({ uri: post.replace('localhost', host), body }),
      (s) => s.url === post && idle(s),
      10000
    );
    if (!form)
      r.check(
        'source.body is sent as a form POST',
        (await text(h, 'body')) === body,
        await text(h, 'body')
      );
    await h.ref.current?.evaluate(`document.getElementById('body').textContent = 'stale'`);
    await waitForLoad(
      h,
      () => h.ref.current?.reload(),
      () => true,
      10000
    );
    await until(async () => (await text(h, 'body').catch(() => 'stale')) !== 'stale', 3000);
    r.check(
      `reload sends the POST again${form}`,
      (await text(h, 'body')) === body,
      await text(h, 'body')
    );
  }

  h.setRules([]);
  await waitForLoad(h, () =>
    h.loadSource({ html: '<p id="html">html source</p>', baseUrl: `${h.pages}/base/` })
  );
  r.check(
    'an html source loads when the rules block every navigation',
    (await text(h, 'html')) === 'html source',
    await text(h, 'html')
  );
  await h.ref.current?.evaluate(`document.getElementById('html').textContent = 'stale'`);
  await waitForLoad(h, () => h.ref.current?.reload());
  await until(async () => (await text(h, 'html').catch(() => 'stale')) !== 'stale', 3000);
  r.check(
    'reload shows the html source again',
    (await text(h, 'html')) === 'html source',
    await text(h, 'html')
  );
  h.setRules(undefined);

  const dir = new Directory(Paths.cache, `site-${Date.now()}`);
  dir.create();
  await new File(dir, 'style.css').write('body { color: rgb(1, 2, 3) }');
  await new File(dir, 'app.js').write('window.__asset = 1');
  const index = new File(dir, 'index.html');
  await index.write(
    '<!doctype html><link rel="stylesheet" href="style.css"><script src="app.js"></script><p id="local">local</p>'
  );
  if (Platform.OS === 'android') h.setProps({ android: { settings: { allowFileAccess: true } } });
  await waitForLoad(
    h,
    () => h.loadSource({ uri: index.uri }),
    (s) => s.url.endsWith('/index.html') && idle(s),
    10000
  );
  const loaded = await h.ref.current?.evaluate(
    `[getComputedStyle(document.body).color, window.__asset, document.getElementById('local')?.textContent]`
  );
  r.check(
    'a file:// source loads with its own stylesheet and script',
    JSON.stringify(loaded) === JSON.stringify(['rgb(1, 2, 3)', 1, 'local']),
    { loaded, url: h.state().url }
  );
  if (Platform.OS === 'ios') {
    const read = async (url: string) =>
      await h.ref.current?.evaluate(`fetch('${url}').then((r) => r.text(), () => 'blocked')`);
    const server = `${h.pages}/common.js`;
    const without = [await read('app.js'), await read(server)];
    h.setProps({ ios: { preferences: { allowFileAccessFromFileURLs: true } } });
    await until(
      async () =>
        (await h.ref.current?.get('preferences.allowFileAccessFromFileURLs').catch(errorCode)) ===
        true,
      3000
    );
    await waitForLoad(h, () => h.ref.current?.reload(), idle, 10000);
    const sibling = await read('app.js');
    r.check(
      'ios.preferences.allowFileAccessFromFileURLs lets a file: page fetch a sibling file',
      without[0] === 'blocked' && sibling === 'window.__asset = 1',
      { without: without[0], sibling }
    );
    await recreate(h, { ios: { configuration: { allowUniversalAccessFromFileURLs: true } } });
    const universal = await read(server);
    r.check(
      'ios.configuration.allowUniversalAccessFromFileURLs lets it fetch from a server with no CORS headers',
      without[1] === 'blocked' && String(universal).includes('window.testLog = []'),
      { without: without[1], universal: String(universal).slice(0, 40) }
    );
  }
  dir.delete();

  for (const [name, uri, shown] of [
    ['an about:blank', 'about:blank', ''],
    ['a data:', 'data:text/html,<p id="data">data source</p>', 'data source'],
  ]) {
    const ended = await happens(waitForLoad(h, () => h.loadSource({ uri }), idle, 10000));
    const page = await text(h, 'data');
    r.check(`${name} source loads`, ended && h.state().outcome === 'finished' && page === shown, {
      state: h.state(),
      page,
    });
  }
}
