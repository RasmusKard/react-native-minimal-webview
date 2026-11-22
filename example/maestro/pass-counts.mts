// Usage: node maestro/pass-counts.mts <junit.xml>...
// Prints how many of the given run.sh JUnit reports passed each check, least passed first. A check a report lacks
// counts as missing, so the runs a suite cut short still count against it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type Tally = { pass: number; fail: number; skip: number; missing: number };

const TESTCASE = /^<testcase classname="([^"]*)" name="([^"]*)"(\/>|><(failure|skipped) )/gm;
const unescape = (text: string) =>
  text.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));

function count(reports: string[]): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  for (const report of reports) {
    const seen = new Set<string>();
    for (const [, classname, name, , failed] of report.matchAll(TESTCASE)) {
      const check = unescape(`${classname} > ${name}`);
      assert(!seen.has(check), `a report has two checks named ${check}`);
      seen.add(check);
      const tally = tallies.get(check) ?? { pass: 0, fail: 0, skip: 0, missing: 0 };
      tally[failed === 'failure' ? 'fail' : failed === 'skipped' ? 'skip' : 'pass'] += 1;
      tallies.set(check, tally);
    }
  }
  for (const tally of tallies.values()) {
    tally.missing = reports.length - tally.pass - tally.fail - tally.skip;
  }
  return tallies;
}

assert.deepEqual(
  count([
    '<testcase classname="a.b" name="x &#62; 1"/>\n<testcase classname="a" name="y"><failure message="z"/></testcase>',
    '<testcase classname="a.b" name="x &#62; 1"/>\n<testcase classname="a" name="w"><skipped message="z"/></testcase>',
  ]),
  new Map([
    ['a.b > x > 1', { pass: 2, fail: 0, skip: 0, missing: 0 }],
    ['a > y', { pass: 0, fail: 1, skip: 0, missing: 1 }],
    ['a > w', { pass: 0, fail: 0, skip: 1, missing: 1 }],
  ])
);

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node maestro/pass-counts.mts <junit.xml>...');
  process.exit(1);
}
const tallies = [...count(files.map((file) => readFileSync(file, 'utf8')))].sort(
  ([, a], [, b]) => a.pass - b.pass
);
console.log('passed\tfailed\tskipped\tmissing\tcheck');
for (const [check, { pass, fail, skip, missing }] of tallies) {
  console.log(`${pass}/${files.length}\t${fail}\t${skip}\t${missing}\t${check}`);
}
