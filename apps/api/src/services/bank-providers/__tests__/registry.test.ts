import { afterEach, describe, expect, it, vi } from 'vitest';

import { bankSyncFeatures, compiledBankProvider, enabledBankProviderIds, getBankProvider, isBankProviderEnabled, nonExpiringBankProviderIds } from '../registry';

/** Which providers an instance runs: the operator's `BANK_PROVIDERS`, with SimpleFIN opt-in. */
describe('bank provider registry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('leaves SimpleFIN off when BANK_PROVIDERS is unset', () => {
    vi.stubEnv('BANK_PROVIDERS', undefined);
    delete process.env['BANK_PROVIDERS'];

    expect(enabledBankProviderIds()).toEqual(['enable_banking']);
    expect(isBankProviderEnabled('simplefin')).toBe(false);
    expect(getBankProvider('simplefin')).toBeUndefined();
    expect(bankSyncFeatures()).toEqual({ bankSync: true, bankSyncCredentials: 'user', bankSyncProviders: ['enable_banking'] });
    expect(nonExpiringBankProviderIds()).toEqual([]);
    // Still readable for reporting on what is already stored.
    expect(compiledBankProvider('simplefin')?.id).toBe('simplefin');
  });

  it('turns SimpleFIN on only when the operator lists it', () => {
    vi.stubEnv('BANK_PROVIDERS', 'enable_banking, simplefin');

    expect(enabledBankProviderIds()).toEqual(['enable_banking', 'simplefin']);
    expect(getBankProvider('simplefin')?.id).toBe('simplefin');
    expect(bankSyncFeatures().bankSyncProviders).toContain('simplefin');
    expect(nonExpiringBankProviderIds()).toEqual(['simplefin']);
  });

  it('can run SimpleFIN alone, and nothing for a list of unknown ids such as none', () => {
    vi.stubEnv('BANK_PROVIDERS', 'simplefin');
    expect(bankSyncFeatures()).toEqual({ bankSync: true, bankSyncCredentials: 'user', bankSyncProviders: ['simplefin'] });

    vi.stubEnv('BANK_PROVIDERS', 'none');
    expect(bankSyncFeatures()).toEqual({ bankSync: false, bankSyncCredentials: 'user', bankSyncProviders: [] });
  });

  it('reads an empty BANK_PROVIDERS (a blank env_file line) as the default', () => {
    vi.stubEnv('BANK_PROVIDERS', ' ');
    expect(enabledBankProviderIds()).toEqual(['enable_banking']);
  });
});
