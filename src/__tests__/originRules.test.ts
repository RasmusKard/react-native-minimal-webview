import vectors from '../../test-vectors/origin-rules.json';
import { createBridge } from '../bridge/createBridge';
import { installPageClient } from '../bridge/pageClient';

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

  it.each(cases)('page client: %s', (_name, c) => {
    const w = {
      location: { origin: c.origin },
      document: { readyState: 'complete' },
      addEventListener: () => {},
    } as unknown as Parameters<typeof installPageClient>[0];
    Object.assign(w, { top: w });
    installPageClient(w, 1000, c.rules);
    expect(w.nativeBridge !== undefined).toBe(c.allowed);
  });
});
