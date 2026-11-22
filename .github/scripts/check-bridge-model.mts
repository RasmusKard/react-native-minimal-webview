// Model-checks the bridge protocol with TLC: src/__tests__/bridge-model/BridgeProtocol.tla, over every order of its
// events within the bounds in BridgeProtocol.cfg. Downloads the pinned tla2tools.jar once to ~/.cache/tla; needs Java.
// Run: node .github/scripts/check-bridge-model.mts [--mutants]
// --mutants also checks that each property still fails on a broken variant of the code it guards.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = '1.7.4';
const SHA256 = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';
const MODEL = new URL('../../src/__tests__/bridge-model/', import.meta.url);
const TEMPORAL = ['EverySettles', 'PageCallAnswered'];

const MUTANTS: { bug: string; from: string; to: string; breaks: string[] }[] = [
  {
    bug: 'createBridge.ts rejectSent rejects every pending call, queued ones too (before 985144a92)',
    from: 'RejectSent == pending \\ QueuedCalls',
    to: 'RejectSent == pending',
    breaks: ['NavigatedOnlyIfPosted'],
  },
  {
    bug: 'createBridge.ts receiveMessage flushes the queue without emptying it (`queue = []`)',
    from: "/\\ queue' = <<>> \\* const flushing = queue; queue = []",
    to: "/\\ queue' = queue",
    breaks: ['QueuedOrPosted', 'RunOnce'],
  },
  {
    bug: 'endpoint.ts rejectPending leaves the timer running (no `clearTimeout`)',
    from: 'StopTimers(t, s) == t \\ s',
    to: 'StopTimers(t, s) == t',
    breaks: ['SettledOnce'],
  },
  {
    bug: 'createBridge.ts receive({ navigated }) skips `rejectSent`',
    from: 'OnNavigated(e) ==\n  LET sent == RejectSent',
    to: 'OnNavigated(e) ==\n  LET sent == {}',
    breaks: ['EverySettles'],
  },
  {
    bug: 'createBridge.ts detach rejects queued calls with `navigated` too',
    from: "/\\ navRejected' = navRejected \\cup RejectSent \\*",
    to: "/\\ navRejected' = navRejected \\cup pending \\*",
    breaks: ['NavigatedOnlyIfPosted'],
  },
  {
    bug: 'pageClient.ts receive acts on any token (no `message.doc === doc`)',
    from: 'Accepts(d, msg) == msg.doc = d',
    to: 'Accepts(d, msg) == TRUE',
    breaks: ['RightPage'],
  },
  {
    bug: "createBridge.ts receive({ navigated }) without the `phase === 'loading'` branch",
    from: 'NeverSaidReady == phase = "loading"',
    to: 'NeverSaidReady == FALSE',
    breaks: ['NotCarriedOver'],
  },
  {
    bug: "MinimalWebViewScripts.kt's web message listener delivers at once: WebView before 119 calls it ahead of the commit's onPageStarted",
    from: "PagePost(e) == looper' = Append(looper, e) /\\ UNCHANGED <<canPost, toRN>>",
    to: "PagePost(e) == canPost' = TRUE /\\ toRN' = Append(toRN, e) /\\ UNCHANGED looper",
    breaks: ['PageCallAnswered', 'EverySettles'],
  },
  {
    bug: "MinimalWebViewScripts.kt documentEnded(CRASHED) keeps the dead page's deliveries (no `removeCallbacksAndMessages`)",
    from: `/\\ looper' = SelectSeq(looper, LAMBDA e: e.type = "navigated")`,
    to: "/\\ looper' = looper",
    breaks: ['EverySettles'],
  },
];

async function tlaTools() {
  const jar = join(homedir(), '.cache', 'tla', `tla2tools-${VERSION}.jar`);
  if (!existsSync(jar)) {
    const url = `https://github.com/tlaplus/tlaplus/releases/download/v${VERSION}/tla2tools.jar`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`downloading ${url}: HTTP ${response.status}`);
    mkdirSync(join(homedir(), '.cache', 'tla'), { recursive: true });
    writeFileSync(jar, Buffer.from(await response.arrayBuffer()));
  }
  const hash = createHash('sha256').update(readFileSync(jar)).digest('hex');
  if (hash !== SHA256)
    throw new Error(`${jar} has sha256 ${hash}, not ${SHA256}: delete it to download it again`);
  return jar;
}

function tlc(jar: string, spec: string, cfg: string) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-model-'));
  try {
    writeFileSync(join(dir, 'BridgeProtocol.tla'), spec);
    writeFileSync(join(dir, 'BridgeProtocol.cfg'), cfg);
    const args = ['-XX:+UseParallelGC', '-cp', jar, 'tlc2.TLC', '-workers', 'auto', '-deadlock'];
    const run = spawnSync(
      'java',
      [...args, '-metadir', join(dir, 'states'), 'BridgeProtocol.tla'],
      {
        cwd: dir,
        encoding: 'utf8',
        maxBuffer: 1 << 28,
      }
    );
    if (run.error) throw run.error;
    return { ok: run.status === 0, output: run.stdout + run.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const jar = await tlaTools();
const spec = readFileSync(new URL('BridgeProtocol.tla', MODEL), 'utf8');
const cfg = readFileSync(new URL('BridgeProtocol.cfg', MODEL), 'utf8');

const started = Date.now();
const result = tlc(jar, spec, cfg);
if (!result.ok) {
  console.log(result.output);
  console.error('The bridge model fails: see the trace above.');
  process.exit(1);
}
const summary = result.output
  .split('\n')
  .filter((line) => /^\d+ states generated|depth of/.test(line));
console.log(
  `Bridge model passes (${Math.round((Date.now() - started) / 1000)} s). ${summary.join(' ')}`
);

function catches(mutant: (typeof MUTANTS)[number], property: string) {
  if (spec.split(mutant.from).length !== 2)
    throw new Error(`the model has no single \`${mutant.from}\``);
  const temporal = TEMPORAL.includes(property);
  const bounds = cfg.slice(0, cfg.indexOf('INVARIANTS'));
  const run = tlc(
    jar,
    spec.replace(mutant.from, mutant.to),
    `${bounds}${temporal ? 'PROPERTY' : 'INVARIANT'} ${property}\n`
  );
  return temporal
    ? run.output.includes('Temporal properties were violated')
    : run.output.includes(`Invariant ${property} is violated`);
}

if (process.argv.includes('--mutants')) {
  let missed = 0;
  for (const [mutant, property] of MUTANTS.flatMap((m) => m.breaks.map((p) => [m, p] as const))) {
    const caught = catches(mutant, property);
    if (!caught) missed++;
    console.log(`${caught ? 'caught' : 'MISSED'}: ${property} on ${mutant.bug}`);
  }
  if (missed) {
    console.error(
      `${missed} mutant check(s) missed: the model can no longer fail where it should.`
    );
    process.exit(1);
  }
}
