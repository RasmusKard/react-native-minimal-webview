// The `perf` suite: what a navigation decision, an `ask`, the bridge, a mount and a WebView instance cost on the
// device. Each number is an INFO line, `perf: <id> {n, p50, p95, …}`; checks hold only what must: full sample counts,
// events complete and in order, and that a navigation a rule decides doesn't wait for a busy JS thread. The
// measurements drive a PerfHost, so another WebView library can run them unchanged. All numbers come from a Debug
// build with Metro.
import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { NavigationRule } from 'react-native-minimal-webview';
import { sampleHook } from 'sample-extension';

import { type Harness, launchMarks, openPage, reporter, sleep, until } from './harness';

type Policy = 'default' | 'rule' | 'ask';
/** A native stamp pair from the sample.perf probe: the page asked to go to `i`, and that navigation started (ns). */
type Mark = { i: string; markNs: number; goNs?: number };
type Report = ReturnType<typeof reporter>;

/** What the measurements drive: this library's WebView in `libraryHost`. */
type PerfHost = {
  pages: string;
  /** No rules (`default`), an `allow` rule, or an `ask` rule whose handler answers `allow` at once. */
  policy: (policy: Policy) => Promise<void>;
  /** Loads `url` and resolves once it has loaded. */
  open: (url: string) => Promise<unknown>;
  /** Runs a script in the page; resolves once it ran. */
  inject: (script: string) => Promise<unknown>;
  /** Remounts the WebView; resolves in its onLoadEnd. */
  remount: () => Promise<void>;
  call: (method: string, params: unknown) => Promise<unknown>;
  emit: (event: string, payload: unknown) => void;
  on: (event: string, listener: (payload: unknown) => void) => () => void;
  /** Renders `n` more WebViews next to the measured one. */
  setExtraWebViews: (n: number) => void;
  /** The native stamps since the last drain (the sample.perf hook); none without the hook. */
  drain?: () => Promise<Mark[]>;
  /** What JS saw of the last navigation loop: its load outcomes. */
  loopInfo?: () => unknown;
};

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
async function posted<T>(host: PerfHost, run: string, ms = 30000): Promise<T | undefined> {
  const text = await until(
    async () => await (await fetch(`${host.pages}/perf/result?run=${run}`)).text(),
    ms,
    250
  );
  return text ? (JSON.parse(text) as T) : undefined;
}
const page = (host: PerfHost, query: string) => `${host.pages}/perf.html?${query}&t=${Date.now()}`;

/** The smallest step of performance.now() and Date.now(), in the page and in Hermes. */
async function clock(host: PerfHost) {
  const run = runId('clock');
  await host.open(page(host, 'clock=1'));
  await host.inject(`perfClock(${JSON.stringify(run)}), 1`);
  type Steps = { performanceNow: number[]; dateNow: number[] };
  const inPage = await posted<Steps>(host, run);
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
 * to the navigation's start) where the host has the probe.
 */
async function navLoop(host: PerfHost, policy: Policy, n: number) {
  await host.policy(policy);
  const run = runId(`nav-${policy}`);
  await host.open(page(host, `run=${run}&i=0&n=${n}`));
  await host.drain?.();
  host.loopInfo?.();
  await host.inject('setTimeout(() => perfGo(true)), 1');
  const e2e = (await posted<number[]>(host, run, n * 1000)) ?? [];
  const marks = await host.drain?.();
  const native = marks?.flatMap((m) => (m.goNs ? [(m.goNs - m.markNs) / 1e6] : []));
  return { e2e, native, marks: marks?.length, info: host.loopInfo?.() };
}

/** Blocks the RN JS thread. */
const busy = (ms: number) => {
  for (const end = Date.now() + ms; Date.now() < end;);
};

/**
 * `n` navigations under `policy`, each while RN's JS thread busy-waits 600 ms, from about 100 ms before the page
 * navigates: end-to-end ms, and the longest main-thread frame gap during each.
 */
async function busyJs(host: PerfHost, policy: Policy, n: number) {
  await host.policy(policy);
  const e2e: number[] = [];
  const gaps: Gaps[] = [];
  for (let k = 0; k < n; k++) {
    const run = runId(`busy-${policy}-${k}`);
    await host.open(page(host, `run=${run}&i=0&n=1`));
    await probe.stallStart();
    await host.inject('setTimeout(() => perfGo(), 100), 1');
    busy(600);
    e2e.push(...((await posted<number[]>(host, run, 10000)) ?? []));
    gaps.push(await probe.stallStop());
  }
  return { e2e, gaps };
}

/** `n` page -> RN -> page calls one after another, timed in the page. */
async function pageCalls(host: PerfHost, n: number) {
  const run = runId('pageCall');
  await host.open(page(host, 'calls=1'));
  await host.inject(`perfPageCalls(${JSON.stringify(run)}, ${n}), 1`);
  return (await posted<number[]>(host, run, 60000)) ?? [];
}

/** `n` RN -> page -> RN calls one after another, timed in Hermes. */
async function rnCalls(host: PerfHost, n: number) {
  await host.open(page(host, 'calls=1'));
  const ms: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = performance.now();
    await host.call('echo', k);
    ms.push(performance.now() - t);
  }
  return ms;
}

/** `n` page events in one loop: ms from the page's first emit to the n-th arriving in RN (one device clock). */
async function pageEmit(host: PerfHost, n: number) {
  const run = runId('pageEmit');
  await host.open(page(host, 'emit=1'));
  const got: unknown[] = [];
  let last = 0;
  const off = host.on('perfEvent', (k) => {
    got.push(k);
    if (got.length === n) last = Date.now();
  });
  try {
    await host.inject(`perfPageEmit(${JSON.stringify(run)}, ${n}), 1`);
    const sent = await posted<{ t0: number; loopMs: number }>(host, run);
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
async function rnEmit(host: PerfHost, n: number) {
  const run = runId('rnEmit');
  await host.open(page(host, 'emit=1'));
  await host.inject(`perfListen(${JSON.stringify(run)}, ${n}), 1`);
  const t0 = Date.now();
  for (let k = 0; k < n; k++) host.emit('perfEvent', k);
  const got = await posted<{ t1: number; n: number; inOrder: boolean }>(host, run, 15000);
  return { ms: got ? got.t1 - t0 : null, got: got?.n ?? 0, inOrder: got?.inOrder === true };
}

/** `n` remounts: ms from the remount to onLoadEnd. */
async function mountWarm(host: PerfHost, n: number) {
  await host.open(`${host.pages}/?perf=mount`);
  const ms: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = performance.now();
    await host.remount();
    ms.push(performance.now() - t);
    await sleep(300);
  }
  return ms;
}

type Memory = { totalKb: number; processes: { pid: number; name: string; kb: number }[] };
/** The median of three memory reads, 1 s apart, after a settle. */
async function readMemory(host: PerfHost, settleMs: number) {
  await sleep(settleMs);
  const reads: Memory[] = [];
  for (let k = 0; k < 3; k++) {
    const response = await fetch(`${host.pages}/driver/memory?platform=${Platform.OS}`);
    if (response.ok) reads.push((await response.json()) as Memory);
    await sleep(1000);
  }
  return reads.sort((a, b) => a.totalKb - b.totalKb)[1];
}

/** Memory with 1 and with 5 WebViews: per instance, (M5 - M1) / 4. */
async function memory(host: PerfHost) {
  await host.open(`${host.pages}/?perf=memory`);
  const one = await readMemory(host, 3000);
  host.setExtraWebViews(4);
  const five = await readMemory(host, 6000);
  host.setExtraWebViews(0);
  const perInstanceKb = one && five ? Math.round((five.totalKb - one.totalKb) / 4) : null;
  return { perInstanceKb, one, five };
}

/** Every measurement, each under its id. */
async function measure(host: PerfHost, r: Report) {
  const count = (id: string, values: unknown[] | undefined, n: number) =>
    r.check(`${id}: all ${n} samples`, values?.length === n, { got: values?.length });

  // First: the remounts and page loads below leave garbage a later read would count.
  const mem = await memory(host);
  r.check('memory: read with 1 and 5 WebViews', mem.perInstanceKb !== null, mem);
  r.info('memory', {
    perInstanceKb: mem.perInstanceKb,
    oneKb: mem.one?.totalKb,
    fiveKb: mem.five?.totalKb,
    one: mem.one?.processes,
    five: mem.five?.processes,
  });

  r.info('clock', await clock(host));

  const e2e: Partial<Record<Policy, number[]>> = {};
  for (const policy of ['default', 'rule', 'ask'] as const) {
    await probe.stallStart();
    const loop = await navLoop(host, policy, 50);
    const gaps = await probe.stallStop();
    e2e[policy] = loop.e2e;
    count(`nav.e2e.${policy}`, loop.e2e, 50);
    r.info(`nav.e2e.${policy}`, stats(loop.e2e));
    if (loop.native) {
      count(`nav.native.${policy}`, loop.native, 50);
      r.info(`nav.native.${policy}`, { ...stats(loop.native), marks: loop.marks });
    }
    if (loop.info !== undefined) r.info(`nav.${policy} outcomes`, loop.info);
    r.info(`ui.maxGap nav.e2e.${policy} (whole loop)`, gaps);
  }

  const busyE2e: Partial<Record<Policy, number[]>> = {};
  for (const policy of ['rule', 'ask'] as const) {
    const run = await busyJs(host, policy, 10);
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

  const pageCall = await pageCalls(host, 200);
  count('bridge.pageCall', pageCall, 200);
  r.info('bridge.pageCall', stats(pageCall));
  const rnCall = await rnCalls(host, 200);
  count('bridge.rnCall', rnCall, 200);
  r.info('bridge.rnCall', stats(rnCall));

  for (const [id, run] of [
    ['bridge.pageEmit', pageEmit],
    ['bridge.rnEmit', rnEmit],
  ] as const) {
    const runs = [];
    for (let k = 0; k < 3; k++) runs.push(await run(host, 1000));
    r.check(
      `${id}: 1000 events arrive, in order, in each of 3 runs`,
      runs.every((x) => x.got === 1000 && x.inOrder && x.ms !== null),
      runs
    );
    const ms = runs.flatMap((x) => (x.ms === null ? [] : [x.ms]));
    r.info(id, { ...stats(ms), perSecond: ms.map((x) => Math.round(1000000 / Math.max(x, 1))) });
  }

  const mount = await mountWarm(host, 20);
  count('mount.warm', mount, 20);
  r.info('mount.warm', stats(mount));
}

/** This library, with the props that would otherwise be inside the numbers off and the probe on. */
async function libraryHost(h: Harness): Promise<PerfHost> {
  let loadEnded: (() => void) | undefined;
  const loads = h.events.loads.length;
  // Shared cookies make each source load wait for one setCookie per native cookie; the page counter runs a script on
  // each load. The probe's key attaches only when the WebView is created: a remount.
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
  await until(() => h.events.loads.slice(loads).includes('end'), 15000, 50);
  const rules: Record<Policy, NavigationRule[] | undefined> = {
    default: undefined,
    rule: [{ scheme: ['http', 'https'], action: 'allow' }],
    ask: [
      { host: ['localhost'], path: ['/perf.html'], action: 'ask' },
      { scheme: ['http', 'https'], action: 'allow' },
    ],
  };
  return {
    pages: h.pages,
    policy: async (policy) => {
      h.setRules(rules[policy]);
      h.setAsk(policy === 'ask' ? () => 'allow' : undefined);
      await sleep(300);
    },
    open: (url) => openPage(h, url),
    inject: async (script) => await h.ref.current?.evaluate(script).catch(String),
    remount: () =>
      new Promise((resolve) => {
        loadEnded = resolve;
        h.remount();
      }),
    call: (method, params) => h.bridge.call(method, params),
    emit: (event, payload) => h.bridge.emit(event, payload),
    on: (event, listener) => h.bridge.on(event, listener),
    setExtraWebViews: h.setExtraWebViews,
    drain: async () => ((await h.ref.current?.hook('sample.perf', 'drain')) ?? []) as Mark[],
    loopInfo: () => {
      const outcomes: Record<string, number> = {};
      for (const outcome of h.events.outcomes.splice(0))
        outcomes[String(outcome)] = (outcomes[String(outcome)] ?? 0) + 1;
      return outcomes;
    },
  };
}

export async function perf(h: Harness) {
  const r = reporter('perf');
  await measure(await libraryHost(h), r);
  r.done();
}

/**
 * The cold mount: from App's first render to its first onLoadEnd, recorded at launch (launchMarks). Run it as the first
 * suite of a run, which launches the app fresh: `maestro/run.sh <platform> <device> perfCold`, once per sample.
 */
export async function perfCold(h: Harness) {
  const r = reporter('perfCold');
  const marks = await until(() => (launchMarks.loadEnd === undefined ? undefined : launchMarks));
  r.check('the first load ended', marks !== undefined, launchMarks);
  if (marks?.render !== undefined && marks.loadEnd !== undefined)
    r.info('mount.cold', { ms: round(marks.loadEnd - marks.render), platform: h.platform });
  r.done();
}
