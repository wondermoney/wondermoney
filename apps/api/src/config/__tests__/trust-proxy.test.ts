import { describe, expect, it } from 'vitest';

import { parseTrustProxy } from '../trust-proxy';

describe('parseTrustProxy', () => {
  it.each([undefined, '', '   ', 'false', 'FALSE', '0'])('trusts no proxy for %j', (raw) => {
    expect(parseTrustProxy(raw)).toBe(false);
  });

  it.each([
    ['1', 1],
    [' 2 ', 2],
  ])('reads %j as a hop count', (raw, hops) => {
    expect(parseTrustProxy(raw)).toBe(hops);
  });

  it('reads a comma-separated list of addresses, ranges and named ranges', () => {
    expect(parseTrustProxy('10.0.0.0/8, 172.16.0.1 ,loopback,2001:db8::/32')).toEqual([
      '10.0.0.0/8',
      '172.16.0.1',
      'loopback',
      '2001:db8::/32',
    ]);
  });

  // `true` makes Express believe the leftmost X-Forwarded-For entry, which the client writes.
  it('refuses to trust every proxy', () => {
    expect(() => parseTrustProxy('true')).toThrow(/hop count/);
  });

  it.each(['-1', '1.5', 'proxy.example.com', '10.0.0.0/33', '10.0.0.1,', 'fe80::/129'])('rejects %j', (raw) => {
    expect(() => parseTrustProxy(raw)).toThrow(/TRUST_PROXY/);
  });
});
