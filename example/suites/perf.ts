// The `perf` suite: what a navigation decision, an `ask`, the bridge, a mount and a WebView instance cost on the
// device. Each number is an INFO line, `perf: <id> {n, p50, p95, …}`; checks hold only what must: full sample counts,
// events complete and in order, and that a navigation a rule decides doesn't wait for a busy JS thread. All numbers
// come from a Debug build with Metro.
import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { NavigationRule } from 'react-native-minimal-webview';
import { sampleHook } from 'sample-extension';

import { openPage, sleep, until, waitForLoad } from '../harness/helpers';
import { launchMarks, type Harness, type Reporter } from '../harness/runner';

type Policy = 'default' | 'rule' | 'ask';
/** A native stamp pair from the sample.perf probe: the page asked to go to `i`, and that navigation started (ns). */
type Mark = { i: string; markNs: number; goNs?: number };

/** The sample extension's frame-gap probe (PerfProbe.swift, PerfProbe.kt): module functions, which need no hook. */
type Gaps = { maxGapMs: number; medianGapMs: number; frames: number };
const probe = requireNativeModule<{ stallStart(): Promise<void>; stallStop(): Promise<Gaps> }>(
  'SampleExtension'
);

const round = (v: number | undefined) => (v === undefined ? null : Math.round(v * 100) / 100);
/**
 * Nearest-rank percentiles, and the mean: for back-to-back samples it is the loop's time over n, so it stays exact
 * where a coarse clock (WebKit's 1 ms performance.now()) quantizes each sample.
 */
function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    min: round(s[0]),
    max: round(s.at(-1)),
    mean: round(s.reduce((sum, v) => sum + v, 0) / s.length),
    unit: 'ms',
  };
}
const median = (values: number[]) => stats(values).p50 ?? NaN;
const runId = (name: string) => `${name}-${Platform.OS}-${Date.now()}`;
/** What the page posted for `run` (perf.html's perfPost), parsed; undefined after `ms`. */
async function posted<T>(h: Harness, run: string, ms = 30000): Promise<T | undefined> {
  const text = await until(
    async () => await (await fetch(`${h.pages}/perf/result?run=${run}`)).text(),
    ms,
    250
  );
  return text ? (JSON.parse(text) as T) : undefined;
}
const page = (h: Harness, query: string) => `${h.pages}/perf.html?${query}&t=${Date.now()}`;

/** The smallest step of performance.now() and Date.now(), in the page and in Hermes. */
async function clock(h: Harness) {
  const run = runId('clock');
  await openPage(h, page(h, 'clock=1'));
  await inject(h, `perfClock(${JSON.stringify(run)}), 1`);
  type Steps = { performanceNow: number[]; dateNow: number[] };
  const inPage = await posted<Steps>(h, run);
  const step = (now: () => number) => {
    const a = now();
    let b = a;
    while (b === a) b = now();
    return b - a;
  };
  const steps = (now: () => number) => Array.from({ length: 20 }, () => step(now));
  const smallest = (s?: Steps) =>
    s && { performanceNowMs: Math.min(...s.performanceNow), dateNowMs: Math.min(...s.dateNow) };
  return {
    page: smallest(inPage),
    hermes: smallest({ performanceNow: steps(() => performance.now()), dateNow: steps(Date.now) }),
  };
}

/**
 * `n` page navigations, each to a new URL (no process swap, no ask memo, no cache), under `policy`: the page's
 * end-to-end ms (from just before `location.href` to the next document's first script) and the native ms (page mark
 * to the navigation's start).
 */
async function navLoop(h: Harness, policy: Policy, n: number) {
  await applyPolicy(h, policy);
  const run = runId(`nav-${policy}`);
  await openPage(h, page(h, `run=${run}&i=0&n=${n}`));
  await drain(h);
  loopInfo(h);
  await inject(h, 'setTimeout(() => perfGo(true)), 1');
  const e2e = (await posted<number[]>(h, run, n * 1000)) ?? [];
  const marks = await drain(h);
  const native = marks.flatMap((m) => (m.goNs ? [(m.goNs - m.markNs) / 1e6] : []));
  return { e2e, native, marks: marks.length, info: loopInfo(h) };
}

/** Blocks the RN JS thread. */
const busy = (ms: number) => {
  for (const end = Date.now() + ms; Date.now() < end;);
};

/**
 * `n` navigations under `policy`, each while RN's JS thread busy-waits 600 ms, from about 100 ms before the page
 * navigates: end-to-end ms, and the longest main-thread frame gap during each.
 */
async function busyJs(h: Harness, policy: Policy, n: number) {
  await applyPolicy(h, policy);
  const e2e: number[] = [];
  const gaps: Gaps[] = [];
  for (let k = 0; k < n; k++) {
    const run = runId(`busy-${policy}-${k}`);
    await openPage(h, page(h, `run=${run}&i=0&n=1`));
    await probe.stallStart();
    await inject(h, 'setTimeout(() => perfGo(), 100), 1');
    busy(600);
    e2e.push(...((await posted<number[]>(h, run, 10000)) ?? []));
    gaps.push(await probe.stallStop());
  }
  return { e2e, gaps };
}

/** `n` page -> RN -> page calls one after another, timed in the page. */
async function pageCalls(h: Harness, n: number) {
  const run = runId('pageCall');
  await openPage(h, page(h, 'calls=1'));
  await inject(h, `perfPageCalls(${JSON.stringify(run)}, ${n}), 1`);
  return (await posted<number[]>(h, run, 60000)) ?? [];
}

/** `n` RN -> page -> RN calls one after another, timed in Hermes. */
async function rnCalls(h: Harness, n: number) {
  await openPage(h, page(h, 'calls=1'));
  const ms: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = performance.now();
    await h.bridge.call('echo', k);
    ms.push(performance.now() - t);
  }
  return ms;
}

/** `n` page events in one loop: ms from the page's first emit to the n-th arriving in RN (one device clock). */
async function pageEmit(h: Harness, n: number) {
  const run = runId('pageEmit');
  await openPage(h, page(h, 'emit=1'));
  const got: unknown[] = [];
  let last = 0;
  const off = h.bridge.on('perfEvent', (k) => {
    got.push(k);
    if (got.length === n) last = Date.now();
  });
  try {
    await inject(h, `perfPageEmit(${JSON.stringify(run)}, ${n}), 1`);
    const sent = await posted<{ t0: number; loopMs: number }>(h, run);
    await until(() => got.length >= n, 10000, 20);
    return {
      ms: sent && last ? last - sent.t0 : null,
      got: got.length,
      inOrder: got.every((k, j) => k === j),
      loopMs: sent?.loopMs,
    };
  } finally {
    off();
  }
}

/** `n` RN events in one loop, after the page is ready: ms from the first emit to the n-th arriving in the page. */
async function rnEmit(h: Harness, n: number) {
  const run = runId('rnEmit');
  await openPage(h, page(h, 'emit=1'));
  await inject(h, `perfListen(${JSON.stringify(run)}, ${n}), 1`);
  const t0 = Date.now();
  for (let k = 0; k < n; k++) h.bridge.emit('perfEvent', k);
  const got = await posted<{ t1: number; n: number; inOrder: boolean }>(h, run, 15000);
  return { ms: got ? got.t1 - t0 : null, got: got?.n ?? 0, inOrder: got?.inOrder === true };
}

/** `n` remounts: ms from the remount to onLoadEnd. */
async function mountWarm(h: Harness, n: number) {
  await openPage(h, `${h.pages}/?perf=mount`);
  const ms: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = performance.now();
    await remount(h);
    ms.push(performance.now() - t);
    await sleep(300);
  }
  return ms;
}

type Memory = { totalKb: number; processes: { pid: number; name: string; kb: number }[] };
/** The median of three memory reads, 1 s apart, after a settle. */
async function readMemory(h: Harness, settleMs: number) {
  await sleep(settleMs);
  const reads: Memory[] = [];
  for (let k = 0; k < 3; k++) {
    const response = await fetch(`${h.pages}/driver/memory?platform=${Platform.OS}`);
    if (response.ok) reads.push((await response.json()) as Memory);
    await sleep(1000);
  }
  return reads.sort((a, b) => a.totalKb - b.totalKb)[1];
}

/** Memory with 1 and with 5 WebViews: per instance, (M5 - M1) / 4. */
async function memory(h: Harness) {
  await openPage(h, `${h.pages}/?perf=memory`);
  const one = await readMemory(h, 3000);
  h.setExtraWebViews(4);
  const five = await readMemory(h, 6000);
  h.setExtraWebViews(0);
  const perInstanceKb = one && five ? Math.round((five.totalKb - one.totalKb) / 4) : null;
  return { perInstanceKb, one, five };
}

/** Every measurement, each under its id. */
async function measure(h: Harness, r: Reporter) {
  const count = (id: string, values: unknown[] | undefined, n: number) =>
    r.check(`${id}: all ${n} samples`, values?.length === n, { got: values?.length });

  // First: the remounts and page loads below leave garbage a later read would count.
  const mem = await memory(h);
  r.check('memory: read with 1 and 5 WebViews', mem.perInstanceKb !== null, mem);
  r.info('memory', {
    perInstanceKb: mem.perInstanceKb,
    oneKb: mem.one?.totalKb,
    fiveKb: mem.five?.totalKb,
    one: mem.one?.processes,
    five: mem.five?.processes,
  });

  r.info('clock', await clock(h));

  const e2e: Partial<Record<Policy, number[]>> = {};
  for (const policy of ['default', 'rule', 'ask'] as const) {
    await probe.stallStart();
    const loop = await navLoop(h, policy, 50);
    const gaps = await probe.stallStop();
    e2e[policy] = loop.e2e;
    count(`nav.e2e.${policy}`, loop.e2e, 50);
    r.info(`nav.e2e.${policy}`, stats(loop.e2e));
    count(`nav.native.${policy}`, loop.native, 50);
    r.info(`nav.native.${policy}`, { ...stats(loop.native), marks: loop.marks });
    r.info(`nav.${policy} outcomes`, loop.info);
    r.info(`ui.maxGap nav.e2e.${policy} (whole loop)`, gaps);
  }

  const busyE2e: Partial<Record<Policy, number[]>> = {};
  for (const policy of ['rule', 'ask'] as const) {
    const run = await busyJs(h, policy, 10);
    busyE2e[policy] = run.e2e;
    count(`nav.busyJs.${policy}`, run.e2e, 10);
    r.info(`nav.busyJs.${policy}`, stats(run.e2e));
    r.info(`ui.maxGap nav.busyJs.${policy}`, {
      ...stats(run.gaps.map((g) => g.maxGapMs)),
      medianGapMs: median(run.gaps.map((g) => g.medianGapMs)),
    });
  }
  const limit = median(e2e.default ?? []) + 150;
  r.check(
    'a navigation a rule decides does not wait for a JS thread blocked for 600 ms',
    median(busyE2e.rule ?? []) < limit,
    { busyRuleP50: median(busyE2e.rule ?? []), limit, defaultP50: median(e2e.default ?? []) }
  );

  const pageCall = await pageCalls(h, 200);
  count('bridge.pageCall', pageCall, 200);
  r.info('bridge.pageCall', stats(pageCall));
  const rnCall = await rnCalls(h, 200);
  count('bridge.rnCall', rnCall, 200);
  r.info('bridge.rnCall', stats(rnCall));

  for (const [id, run] of [
    ['bridge.pageEmit', pageEmit],
    ['bridge.rnEmit', rnEmit],
  ] as const) {
    const runs = [];
    for (let k = 0; k < 3; k++) runs.push(await run(h, 1000));
    r.check(
      `${id}: 1000 events arrive, in order, in each of 3 runs`,
      runs.every((x) => x.got === 1000 && x.inOrder && x.ms !== null),
      runs
    );
    const ms = runs.flatMap((x) => (x.ms === null ? [] : [x.ms]));
    r.info(id, { ...stats(ms), perSecond: ms.map((x) => Math.round(1000000 / Math.max(x, 1))) });
  }

  const mount = await mountWarm(h, 20);
  count('mount.warm', mount, 20);
  r.info('mount.warm', stats(mount));
}

let loadEnded: (() => void) | undefined;
/** Turns off the props that would otherwise be inside the numbers, and turns the probe on. */
async function setUp(h: Harness) {
  // Shared cookies make each source load wait for one setCookie per native cookie; the page counter runs a script on
  // each load. The probe's key attaches only when the WebView is created: a remount.
  await waitForLoad(
    h,
    () => {
      h.setProps({
        sharedCookies: false,
        pullToRefresh: false,
        extensions: [sampleHook('perf')],
        withoutPageCounter: true,
        onLoadEnd: ({ outcome }) => {
          h.events.loads.push('end');
          h.events.outcomes.push(outcome);
          loadEnded?.();
          loadEnded = undefined;
        },
      });
      h.remount();
    },
    () => true
  );
}
/** Remounts the WebView; resolves in its onLoadEnd. */
const remount = (h: Harness) =>
  new Promise<void>((resolve) => {
    loadEnded = resolve;
    h.remount();
  });
const RULES: Record<Policy, NavigationRule[] | undefined> = {
  default: undefined,
  rule: [{ scheme: ['http', 'https'], action: 'allow' }],
  ask: [
    { host: ['localhost'], path: ['/perf.html'], action: 'ask' },
    { scheme: ['http', 'https'], action: 'allow' },
  ],
};
/** No rules (`default`), an `allow` rule, or an `ask` rule whose handler answers `allow` at once. */
async function applyPolicy(h: Harness, policy: Policy) {
  h.setRules(RULES[policy]);
  h.setAsk(policy === 'ask' ? () => 'allow' : undefined);
  await sleep(300);
}
/** Runs a script in the page; resolves once it ran. */
const inject = async (h: Harness, script: string) =>
  await h.ref.current?.evaluate(script).catch(String);
/** The native stamps since the last drain (the sample.perf hook). */
const drain = async (h: Harness) =>
  ((await h.ref.current?.hook('sample.perf', 'drain')) ?? []) as Mark[];
/** What JS saw of the last navigation loop: its load outcomes. */
function loopInfo(h: Harness) {
  const outcomes: Record<string, number> = {};
  for (const outcome of h.events.outcomes.splice(0))
    outcomes[String(outcome)] = (outcomes[String(outcome)] ?? 0) + 1;
  return outcomes;
}

export async function perf(h: Harness, r: Reporter) {
  await setUp(h);
  await measure(h, r);
}

/**
 * The cold mount: from App's first render to its first onLoadEnd, recorded at launch (launchMarks). Run it as the first
 * suite of a run, which launches the app fresh: `maestro/run.sh <platform> <device> perfCold`, once per sample.
 */
export async function perfCold(h: Harness, r: Reporter) {
  const marks = await until(() => (launchMarks.loadEnd === undefined ? undefined : launchMarks));
  r.check('the first load ended', marks !== undefined, launchMarks);
  if (marks?.render !== undefined && marks.loadEnd !== undefined)
    r.info('mount.cold', { ms: round(marks.loadEnd - marks.render), platform: h.platform });
}
