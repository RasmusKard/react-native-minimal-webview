import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import vectors from '../../test-vectors/origin-rules.json';
import { createBridge } from '../bridge/createBridge';
import { installPageClient } from '../bridge/pageClient';

const cases = vectors.cases.map((c) => [c.name, c] as const);

// The iOS delivery script (MinimalWebView+Bridge.swift `deliver`), run as callAsyncJavaScript would.
const deliver = /static let deliver = #?"""\n([\s\S]*?)\n\s*"""#?/.exec(
  readFileSync(join(__dirname, '../../ios/MinimalWebView+Bridge.swift'), 'utf8')
)![1];

describe('origin rules (shared cases)', () => {
  const rules = (valid: boolean) =>
    vectors.validation.filter((v) => v.valid === valid).map((v) => v.rule);
  it.each(rules(true))('createBridge accepts %j', (rule) => {
    expect(() => createBridge({ allowedOrigins: [rule] })).not.toThrow();
  });
  it.each(rules(false))('createBridge rejects %j', (rule) => {
    expect(() => createBridge({ allowedOrigins: [rule] })).toThrow('invalid allowedOrigins');
  });

  it.each(cases)('page client: %s', (_name, c) => {
    const w = { location: { origin: c.origin } } as Parameters<typeof installPageClient>[0];
    Object.assign(w, { top: w });
    installPageClient(w, 1000, c.rules);
    expect(w.nativeBridge !== undefined).toBe(c.allowed);
  });

  it.each(cases)('iOS delivery script: %s', async (_name, c) => {
    const window = { nativeBridge: { __receive: (message: string) => `got ${message}` } };
    const run = runInNewContext(`(async (location, window, origins, message) => {${deliver}})`) as (
      location: object,
      window: object,
      origins: string[],
      message: string
    ) => Promise<unknown>;
    const reply = await run({ origin: c.origin }, window, c.rules, 'm');
    expect(reply === 'got m').toBe(c.allowed);
  });
});
