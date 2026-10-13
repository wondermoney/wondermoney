import { describe, expect, it } from 'vitest';

import { sanitizeErrorUrl } from '../error-sanitizer';

describe('banking callback telemetry sanitization', () => {
  it('redacts every provider-controlled callback query value', () => {
    const sanitized = sanitizeErrorUrl('/v1/banking/bank/connection_callback?ref=raw-ref&error=raw-error&details=raw-details&redirectPage=pt%2Faccounts');

    expect(sanitized).not.toMatch(/raw-ref|raw-error|raw-details|pt%2Faccounts/);
    expect(sanitized).toBe('/v1/banking/bank/connection_callback?ref=%5BREDACTED%5D&error=%5BREDACTED%5D&details=%5BREDACTED%5D&redirectPage=%5BREDACTED%5D');
  });
});
