import {
  clearEvents,
  errorCode,
  fresh,
  idle,
  openPage,
  sleep,
  waitFor,
  poll,
  happens,
} from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';

/**
 * The `pullToRefresh` prop. The gesture comes from outside the app: the suite asks the driver for each swipe.
 */
export async function ptr(h: Harness, r: Reporter) {
  // The evaluate rejects with `navigated` when the pull's reload replaces the page mid-call; the next poll retries.
  const loadedAt = async () =>
    (await h.ref.current
      ?.evaluate(`document.getElementById('loaded').textContent`)
      .catch((error: unknown) => {
        r.info('the page gave no load time', errorCode(error));
        return null;
      })) as string | null;
  const open = async (mode: string) => {
    await openPage(h, fresh(h, `/ptr.html?mode=${mode}`));
    await sleep(200);
  };
  const pull = async (kind: 'full' | 'short' | 'inner') => {
    const before = await loadedAt();
    r.drive({ action: 'swipe', kind });
    return !!(await poll(async () => idle(h.state()) && (await loadedAt()) !== before, 10000, 250));
  };
  /**
   * A pull that must not reload. It has landed once it scrolls `position` (the page or the inner scroller) up by more than
   * 30 px (a pull moves it 90 px or more), and a reload it wrongly started would follow within a second (the release,
   * then the refresh). Waiting from the landing rather than from the request also fails a pull that never came.
   */
  const pullStays = async (kind: 'short' | 'inner', position: string) => {
    const at = async () => (await h.ref.current?.evaluate(position)) as number;
    // iOS keeps moving the page for a moment after a scrollTo while the last pull's refresh control hides: start from
    // where it holds still.
    let top = await at();
    for (
      let since = Date.now(), end = since + 5000;
      Date.now() - since < 500 && Date.now() < end;
    ) {
      await sleep(100);
      const now = await at();
      if (now !== top) [top, since] = [now, Date.now()];
    }
    const [loads, was] = [h.events.loads.length, await loadedAt()];
    const reloaded = async () => h.events.loads.length > loads || (await loadedAt()) !== was;
    const scrolled = async () => {
      const now = await h.ref.current?.evaluate(position).catch(errorCode);
      return typeof now === 'number' && now < top - 30;
    };
    r.drive({ action: 'swipe', kind });
    const landed = await poll(async () => (await reloaded()) || (await scrolled()), 15000);
    if (landed) await poll(reloaded, 3000);
    return (await reloaded()) ? 'reloaded' : landed ? 'stayed' : 'the pull never came';
  };

  await open('long');
  r.check('pull at the top of a long page reloads', await pull('full'));
  await open('short');
  r.check('pull on a short page reloads', await pull('full'));
  await open('long');
  await h.ref.current?.evaluate('window.scrollTo(0, 1500)');
  const short = await pullStays('short', 'window.scrollY');
  r.check('a short pull while scrolled down does not reload', short === 'stayed', short);
  r.info('scrollY after the pull', await h.ref.current?.evaluate('window.scrollY'));
  await open('inner');
  await h.ref.current?.evaluate(`document.getElementById('scroller').scrollTop = 400`);
  const inner = await pullStays('inner', `document.getElementById('scroller').scrollTop`);
  r.check('a pull inside a scrolled inner scroller does not reload', inner === 'stayed', inner);
  // With the prop off, the layout stays around the WebView but takes no pull. The next setProps turns it back on (the
  // app's default), which the failing reload's pull below needs.
  h.setProps({ pullToRefresh: false });
  await open('long');
  r.check('no pull to refresh while the prop is off', !(await pull('full')));

  // A reload that fails must end the refresh, or the control stays refreshing and ignores the next pull.
  // The example's error screen would cover the WebView and take the next pull: keep its onError out of the way.
  h.setProps({ onError: (event) => h.events.errors.push(event) });
  const key = Date.now();
  const dropping = `${h.pages}/drop?key=${key}`;
  await openPage(h, dropping);
  await sleep(200);
  clearEvents(h);
  await fetch(`${h.pages}/drop/set?key=${key}&fail=1`);
  // Wait for the error, not for a new page: iOS keeps the old one when the reload fails.
  r.drive({ action: 'swipe', kind: 'full' });
  r.check(
    'a pull whose reload fails reports the error',
    await happens(waitFor(h, () => h.events.errors.some((e) => e.kind === 'network'), 15000)),
    h.events.errors
  );
  await waitFor(h, idle, 5000);
  await fetch(`${h.pages}/drop/set?key=${key}&fail=0`);
  await sleep(1000);
  r.check('the next pull after a failed reload works', await pull('full'));
}
