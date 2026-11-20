import { fresh, openPage, text, until } from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';

/** First-load headers and shared cookies. */
export async function network(h: Harness, r: Reporter) {
  const headersPage = fresh(h, '/headers');
  await openPage(h, { uri: headersPage, headers: { 'X-Test-Header': 'hello' } }, 10000);
  r.check(
    'source.headers reach the first request',
    (await text(h, 'headers')).includes('"x-test-header":"hello"')
  );

  await fetch(`${h.pages}/setcookie?name=fromNative&value=${Date.now()}`);
  await openPage(h, fresh(h, '/cookies'));
  r.check(
    'a cookie set by a native request reaches the page',
    (await text(h, 'cookies')).includes('fromNative='),
    await text(h, 'cookies')
  );
  await h.ref.current?.evaluate(`document.cookie = 'fromPage=${Date.now()}; path=/'`);
  // It reaches the shared store on the platform's schedule: ask until it shows.
  let native = '';
  await until(async () => {
    native = await fetch(`${h.pages}/cookies`).then((res) => res.text());
    return native.includes('fromPage=');
  }, 5000);
  r.check(
    'a cookie set by the page reaches native requests',
    native.includes('fromPage='),
    native.slice(0, 200)
  );
  // A cookie the page deletes (a logout) leaves native too, so the next source load doesn't bring it back.
  await h.ref.current?.evaluate(
    "document.cookie = 'fromPage=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'"
  );
  await until(
    async () =>
      !(await fetch(`${h.pages}/cookies`).then((res) => res.text())).includes('fromPage='),
    5000
  );
  await openPage(h, fresh(h, '/cookies'));
  r.check(
    'a cookie the page deletes stays deleted after the next source load',
    !(await text(h, 'cookies')).includes('fromPage='),
    await text(h, 'cookies')
  );
}
