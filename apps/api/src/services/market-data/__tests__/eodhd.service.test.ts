import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('eodhd.service (lazy client construction)', () => {
  const originalEnv = process.env['EODHD_API_KEY'];

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env['EODHD_API_KEY'] = originalEnv;
  });

  it('reports market data as disabled when EODHD_API_KEY is not set and a method is called', async () => {
    delete process.env['EODHD_API_KEY'];
    const { default: eodhd, isMarketDataEnabled } = await import('../eodhd.service');
    expect(isMarketDataEnabled()).toBe(false);
    expect(() => eodhd.search('Apple')).toThrow(expect.objectContaining({ code: 'feature_disabled' }) as Error);
  });

  it('reports market data as available once a key is set', async () => {
    process.env['EODHD_API_KEY'] = 'key';
    const { isMarketDataEnabled } = await import('../eodhd.service');
    expect(isMarketDataEnabled()).toBe(true);
  });

  it('does not throw at import time when EODHD_API_KEY is unset (lazy construction)', async () => {
    delete process.env['EODHD_API_KEY'];
    await expect(import('../eodhd.service')).resolves.toBeDefined();
  });
});
