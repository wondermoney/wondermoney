import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAllowedOrigins, getCorsAllowedOrigins, privacyPolicyUrl } from '@utils/constants';

describe('getAllowedOrigins', () => {
  it('limits credentialed production CORS to the app origin', () => {
    const origins = getAllowedOrigins('production');

    expect(origins).toEqual(['https://app.example.test']);
  });

  it('includes localhost origins outside production', () => {
    expect(getAllowedOrigins('development')).toContain('http://localhost:3000');
    expect(getAllowedOrigins('staging')).toContain('https://app.example.test');
  });

  it('normalizes explicitly configured CORS origins', () => {
    expect(getAllowedOrigins('production', 'https://app.wonder.money/, https://staging.app.wonder.money/path')).toEqual([
      'https://app.wonder.money',
      'https://staging.app.wonder.money',
    ]);
  });

  it('fails closed to production origins for unknown environments', () => {
    expect(getCorsAllowedOrigins('prod')).toEqual(['https://app.example.test']);
  });
});

describe('privacyPolicyUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fills the language into a configured privacy policy address', () => {
    vi.stubEnv('PRIVACY_POLICY_URL', 'https://example.com/{lang}/privacy');
    expect(privacyPolicyUrl('pt')).toBe('https://example.com/pt/privacy');
  });

  it('points at the app privacy settings when none is configured', () => {
    vi.stubEnv('PRIVACY_POLICY_URL', '');
    expect(privacyPolicyUrl('en')).toMatch(/\/en\/settings\?tab=privacy$/u);
  });
});
