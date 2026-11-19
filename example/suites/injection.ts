import { fresh, openPage, sleep, text, until } from '../harness/helpers';
import { WEBVIEW, type Harness, type Reporter, withFloor } from '../harness/runner';

/**
 * The `injectedScripts` prop: when its scripts run, in which frames and on which origins, and that a change applies
 * from the next load.
 */
export async function injection(h: Harness, all: Reporter) {
  const r = withFloor(all, WEBVIEW.injectedScripts);
  h.setProps({
    injectedScripts: [
      {
        code: 'window.__injectedStart = true;\nfunction __globalFn() {}',
        allFrames: true,
        origins: ['*'],
      },
      { code: 'window.__mainOnly = true; window.__marker = "one";', origins: ['*'] },
      {
        code: `addEventListener('DOMContentLoaded', () => (window.__injectedEnd = !!document.getElementById('end')));`,
        origins: ['*'],
      },
      {
        code: 'window.__scoped = true;\nfunction __scopedFn() {}',
        allFrames: true,
        origins: [h.pages],
      },
      { code: 'window.__elsewhere = true;', allFrames: true, origins: ['https://example.com'] },
    ],
  });
  await sleep(500);
  await openPage(h, fresh(h, '/injection.html'));
  await until(async () => (await text(h, 'end')) !== '', 3000); // the page's load listener fills it
  r.check('a script runs before page scripts', (await text(h, 'start')) === 'true');
  r.check(
    'its DOMContentLoaded listener runs once the DOM is parsed',
    (await text(h, 'end')) === 'true'
  );
  const frame = (await h.ref.current?.evaluate(`(() => {
    const w = document.querySelector('iframe').contentWindow;
    return { start: w.__injectedStart === true, mainOnly: w.__mainOnly === true, top: window.__mainOnly === true };
  })()`)) as { start: boolean; mainOnly: boolean; top: boolean };
  r.check('an allFrames script runs in iframes', frame.start, frame);
  r.check('a script runs in the main frame only by default', frame.top && !frame.mainOnly, frame);
  const scoped = (await h.ref.current?.evaluate(`(() => {
    const w = document.querySelector('iframe').contentWindow;
    return {
      main: window.__scoped === true, frame: w.__scoped === true, elsewhere: window.__elsewhere === true || w.__elsewhere === true,
      scopedFn: typeof __scopedFn, globalFn: typeof __globalFn,
    };
  })()`)) as Record<string, unknown>;
  r.check(
    'a scoped script runs on its origins only, main frame and iframes',
    scoped['main'] === true && scoped['frame'] === true && scoped['elsewhere'] === false,
    scoped
  );
  r.check(
    "a scoped script's declarations stay local; with '*' they are global",
    scoped['scopedFn'] === 'undefined' && scoped['globalFn'] === 'function',
    scoped
  );
  h.setProps({ injectedScripts: [{ code: 'window.__marker = "two";', origins: ['*'] }] });
  await sleep(500);
  r.check(
    'a changed script waits for the next navigation',
    (await h.ref.current?.evaluate('window.__marker')) === 'one'
  );
  await openPage(h, fresh(h, '/injection.html'));
  r.check(
    'the changed script applies after navigation',
    (await h.ref.current?.evaluate('window.__marker')) === 'two'
  );
  r.check('the removed script is gone', (await text(h, 'start')) === 'false');
  r.check(
    'the bridge page client still installs',
    (await h.ref.current?.evaluate('typeof window.nativeBridge')) === 'object'
  );
}
