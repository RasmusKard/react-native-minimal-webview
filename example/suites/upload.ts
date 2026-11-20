import { File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import { AppState, Platform } from 'react-native';
import type { FileRequest } from 'react-native-minimal-webview';

import {
  fresh,
  openPage,
  pageLog,
  sleep,
  stuckHandler,
  until,
  reachesJs,
} from '../harness/helpers';
import { WEBVIEW, type Harness, type Reporter } from '../harness/runner';

/**
 * Android file chooser through onFileRequest: the app answers with URIs it got from an Expo API. Without the prop, the
 * system chooser. The taps come from the driver, because WebView only opens choosers on a real gesture.
 */
export async function upload(h: Harness, r: Reporter) {
  if (Platform.OS !== 'android') {
    r.skip('the suite', 'onFileRequest is Android only');
    return;
  }
  const file = new File(Paths.cache, 'upload-test.txt');
  file.create({ overwrite: true });
  await file.write('hello from the app cache');
  const requests: FileRequest[] = [];
  let answer: string[] | null = null;
  let hang = false;
  const { stuck, never } = stuckHandler<null>();
  h.setFileRequest(async (request, signal) => {
    requests.push(request);
    return hang ? await never(signal) : answer;
  });
  const open = async () => {
    await openPage(h, fresh(h, '/upload.html'));
    await sleep(200);
  };
  await open();
  // The file input fills the page (upload.html). What the page logs after the tap, '' when nothing.
  const point = '50%, 49%';
  const tapAndRead = async (label: string, action: 'tap' | 'tapThenBack' = 'tap') =>
    (await pageLog(h, () => r.drive({ action, point }, label)))?.join(' | ') ?? '';

  answer = [file.uri];
  const fromFileUri = await tapAndRead('file uri');
  r.info('file:// URI', file.uri);
  r.check(
    'a file:// URI from the app cache uploads (allowFileAccess off)',
    fromFileUri.includes('hello from the app cache'),
    fromFileUri
  );
  r.check(
    'the request carries accept, multiple and capture',
    requests[0]?.accept.join() === 'text/plain,image/*' &&
      requests[0].multiple === false &&
      requests[0].capture === false,
    requests[0]
  );

  answer = [await getContentUriAsync(file.uri)];
  const fromContentUri = await tapAndRead('content uri');
  r.info('content:// URI', answer[0]);
  r.check(
    'a content:// URI (FileProvider) uploads',
    fromContentUri.includes('hello from the app cache'),
    fromContentUri
  );

  answer = null;
  const cancelled = await tapAndRead('cancel');
  r.info('after cancel the page logged', cancelled);
  answer = [file.uri];
  const again = await tapAndRead('after cancel');
  r.check(
    'the chooser opens again after a cancel (callback called once)',
    again.includes('hello'),
    again
  );

  // A handler that never settles holds the page's chooser (WebView allows one); the next page cancels it and aborts
  // the handler's signal.
  hang = true;
  const held = requests.length;
  r.drive({ action: 'tap', point }, 'never settles');
  await reachesJs(r, () => requests.length, held);
  hang = false;
  const navigatedAt = Date.now();
  await open();
  await until(() => stuck.abortedAt, 2000);
  r.check(
    "navigating away aborts the held handler's signal",
    stuck.abortedAt >= navigatedAt,
    stuck.abortedAt ? stuck.abortedAt - navigatedAt : 'not aborted'
  );
  const afterHang = await tapAndRead('after navigation');
  r.check(
    'after navigating, the next request reaches JS and uploads',
    requests.length === held + 2 && afterHang.includes('hello'),
    { requests: requests.length - held, afterHang }
  );

  // Without onFileRequest: the system chooser. It covers the app (AppState goes background); the driver presses back.
  h.setProps({ onFileRequest: undefined });
  const states: string[] = [];
  const subscription = AppState.addEventListener('change', (state) => states.push(state));
  r.cleanup(() => subscription.remove());
  for (const label of ['system chooser', 'system chooser again']) {
    states.length = 0;
    const logged = await tapAndRead(label, 'tapThenBack');
    r.check(
      `without onFileRequest the system chooser opens (${label})`,
      states.includes('background'),
      states
    );
    r.since(
      WEBVIEW.fileInputCancel,
      `back cancels it (${label})`,
      logged.includes('cancelled'),
      logged
    );
  }
  subscription.remove();
  h.setProps({});
  const restored = await tapAndRead('onFileRequest again');
  r.check(
    'onFileRequest set again takes over without a remount',
    restored.includes('hello'),
    restored
  );
}
