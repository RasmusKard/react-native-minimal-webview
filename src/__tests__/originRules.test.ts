import { runInNewContext } from 'node:vm';

import vectors from './vectors/origin-rules.json';
import { CONNECTION, createBridge } from '../bridge/createBridge';
import { matchesOrigin } from '../bridge/matchesOrigin';
import { originForms } from '../bridge/origins';

const cases = vectors.cases.map((c) => [c.name, c] as const);

describe('origin rules (shared cases)', () => {
  const rules = (valid: boolean) =>
    vectors.validation.filter((v) => v.valid === valid).map((v) => v.rule);
  it.each(rules(true))('createBridge accepts %j', (rule) => {
    expect(() => createBridge({ allowedOrigins: [rule] })).not.toThrow();
  });
  it.each(rules(false))('createBridge rejects %j', (rule) => {
    expect(() => createBridge({ allowedOrigins: [rule] })).toThrow('invalid allowedOrigins');
  });

  it.each(cases)('the injected scripts guard: %s', (_name, c) => {
    expect(matchesOrigin(originForms(c.rules), c.origin)).toBe(c.allowed);
  });
});

it.each([
  ['another origin', ['https://example.com'], false],
  ['* rules', ['*'], true],
])("createBridge's page client installs on %s", (_name, allowedOrigins, installed) => {
  const w: Record<string, unknown> = {
    location: { origin: 'https://evil.example' },
    document: { readyState: 'complete' },
    addEventListener: () => {},
  };
  w.top = w;
  w.window = w;
  runInNewContext(createBridge({ allowedOrigins })[CONNECTION].script, w);
  expect(w.nativeBridge !== undefined).toBe(installed);
});
