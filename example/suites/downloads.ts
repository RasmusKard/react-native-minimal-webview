import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import {
  click,
  fresh,
  openPage,
  poll,
  recordExternal,
  sleep,
  waitFor,
  happens,
} from '../harness/helpers';
import { WEBVIEW, type Harness, type Reporter } from '../harness/runner';

const blobLink = (h: Harness, id: string, bytes: number) =>
  h.ref.current?.evaluate(
    `(() => { const a = document.createElement('a'); a.id = '${id}'; a.download = '${id}.bin'; a.href = URL.createObjectURL(new Blob([new Uint8Array(${bytes})])); document.body.append(a); })()`
  );

export async function downloadsSuite(h: Harness, r: Reporter) {
  await openPage(h, fresh(h, '/media.html'));
  await h.ref.current?.evaluate("document.cookie = 'dl=1'");
  const attachmentUrl = await h.ref.current?.evaluate(
    "(() => { const a = document.getElementById('attachment'); a.href += '&pad=' + 'x'.repeat(200); return a.href; })()"
  );
  for (const [id, filename, body] of [
    ['attachment', 'report.txt', 'downloaded report.txt'],
    ['blob', 'blob.txt', 'blob body'],
    ['data', 'data.txt', 'data body'],
    ['moved', 'moved.txt', Platform.OS === 'android' ? 'downloaded moved.txt' : 'first response'],
  ] as const) {
    const [before, outcomes] = [h.events.downloads.length, h.events.outcomes.length];
    await click(h, id);
    const done = await happens(waitFor(h, () => h.events.downloads.length > before, 20000));
    const download = h.events.downloads[before];
    if (id === 'attachment') {
      await poll(() => h.events.outcomes.length > outcomes, 2000);
      r.since(
        WEBVIEW.navigationListener,
        'the attachment load ends as cancelled',
        h.events.outcomes.length === outcomes + 1 && h.events.outcomes[outcomes] === 'cancelled',
        h.events.outcomes.slice(outcomes)
      );
    }
    const nameOk =
      Platform.OS === 'android' && (id === 'blob' || id === 'data')
        ? download?.filename.endsWith('.txt')
        : download?.filename === filename;
    const floor = id === 'blob' ? WEBVIEW.evaluate : 0;
    r.since(floor, `${id} download reaches onDownload`, done && nameOk === true, download);
    const text = download?.uri.startsWith('file:') ? await new File(download.uri).text() : null;
    r.since(
      floor,
      `${id} file holds the body`,
      text?.startsWith(body) === true,
      text?.slice(0, 80)
    );
    if (id === 'attachment')
      r.check(
        'the attachment request carries the page cookie',
        text?.includes('dl=1') === true,
        text
      );
    const url =
      id === 'attachment'
        ? attachmentUrl
        : id === 'moved'
          ? await h.ref.current?.evaluate("document.getElementById('moved').href")
          : null;
    r.since(
      floor,
      `${id} download url is ${url === null ? 'null' : 'the full server URL'}`,
      download?.url === url,
      download?.url
    );
  }

  if (Platform.OS === 'android') {
    const failures = h.events.downloadFailures.length;
    await blobLink(h, 'bigblob', 101 * 1024 * 1024);
    await click(h, 'bigblob');
    const failed = await happens(
      waitFor(h, () => h.events.downloadFailures.length > failures, 20000)
    );
    const failure = h.events.downloadFailures[failures];
    r.check(
      'a blob above the size cap reports a data failure with a description',
      failed && failure?.kind === 'data' && failure.description.includes('larger than'),
      failure
    );
    const big = h.events.downloads.length;
    await blobLink(h, 'bigok', 40 * 1024 * 1024);
    await click(h, 'bigok');
    const saved = await happens(waitFor(h, () => h.events.downloads.length > big, 30000));
    const bigFile = saved ? new File(h.events.downloads[big].uri) : null;
    r.since(
      WEBVIEW.evaluate,
      'a 40 MiB blob downloads whole',
      bigFile?.size === 40 * 1024 * 1024,
      h.events.downloads[big]
    );
    bigFile?.delete();
  }

  const opened: string[] = [];
  h.setProps({
    onDownload: undefined,
    onOpenExternal: recordExternal(opened),
  });
  await sleep(300);
  const events = () => h.events.downloads.length + h.events.downloadFailures.length;
  const before = events();
  const page = h.state().url;
  await click(h, 'attachment');
  await waitFor(h, () => opened.length > 0);
  r.check(
    'without onDownload an http download goes to onOpenExternal',
    opened[0] === attachmentUrl,
    opened
  );
  await click(h, 'blob');
  await click(h, 'data');
  await sleep(1500);
  r.check(
    'without onDownload data: and blob: are dropped (no event, no navigation)',
    events() === before && opened.length === 1 && h.state().url === page,
    { events: events() - before, opened, url: h.state().url }
  );
  const downloads = h.events.downloads.length;
  h.setProps({});
  await sleep(300);
  await click(h, 'data');
  r.check(
    'onDownload set again takes over without a remount',
    (await happens(waitFor(h, () => h.events.downloads.length > downloads, 10000))) &&
      opened.length === 1
  );

  if (Platform.OS === 'android') {
    await openPage(h, fresh(h, '/media.html'));
    const before = h.events.downloadFailures.length;
    await click(h, 'baddata');
    await happens(waitFor(h, () => h.events.downloadFailures.length > before, 1500));
    r.info('invalid data: download failures reported', h.events.downloadFailures.slice(before));
    r.check(
      'the app survives an invalid data: download',
      (await h.ref.current?.evaluate('1 + 1')) === 2
    );
  }
}
