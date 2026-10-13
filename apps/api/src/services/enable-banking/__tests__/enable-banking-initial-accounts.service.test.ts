import type { EntityManager } from '@mikro-orm/core';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

import type { EnableBankingConnection } from '@entity/EnableBankingConnection';

import { createInitialEnableBankingAccounts } from '../enable-banking-initial-accounts.service';

const connection = (overrides: { tenantKey?: unknown } = {}) => ({
  appuserKey: { appuserKey: 9 },
  aspspCountry: 'PT',
  aspspName: 'Test Bank',
  enableBankingConnectionKey: 5,
  tenantKey: { tenantKey: 3 },
  ...overrides,
}) as unknown as EnableBankingConnection;

function createEm(overrides: Partial<{ currency: unknown; existingAccount: unknown; existingDeleted: unknown; institution: unknown; persistRejects: unknown[] }> = {}) {
  const flush = vi.fn();
  for (const rejection of overrides.persistRejects ?? []) flush.mockRejectedValueOnce(rejection);
  flush.mockResolvedValue(undefined);
  return {
    create: vi.fn((_entity: unknown, data: unknown) => data),
    findOne: vi.fn((entity: unknown, where: Record<string, unknown>) => {
      const name = (entity as { name?: string }).name;
      if (name === 'AccountFinancialInstitution') return Object.hasOwn(overrides, 'institution') ? overrides.institution : null;
      if (name === 'Currency') return Object.hasOwn(overrides, 'currency') ? overrides.currency : { code: 'EUR' };
      if (name === 'Account') return Object.hasOwn(where, 'deletedAt') && (where['deletedAt'] as Record<string, unknown> | undefined)?.['$ne'] !== undefined
        ? (Object.hasOwn(overrides, 'existingDeleted') ? overrides.existingDeleted : null)
        : (Object.hasOwn(overrides, 'existingAccount') ? overrides.existingAccount : null);
      return null;
    }),
    findOneOrFail: vi.fn(() => (Object.hasOwn(overrides, 'institution') ? overrides.institution : { id: 'enable_banking:pt:test-bank' })),
    flush,
    persist: vi.fn().mockReturnThis(),
  };
}

describe('createInitialEnableBankingAccounts', () => {
  it('throws when the connection has no tenant', async () => {
    const em = createEm();
    await expect(createInitialEnableBankingAccounts(em as unknown as EntityManager, connection({ tenantKey: undefined }), [{ currency: 'EUR', uid: 'acc-1' }])).rejects.toThrow('missing tenant ownership');
  });

  it('creates an institution and an account for a valid session account', async () => {
    const em = createEm();
    const result = await createInitialEnableBankingAccounts(em as unknown as EntityManager, connection(), [
      { account_id: { iban: 'PT50000000000000000000000' }, currency: 'EUR', name: 'Checking', uid: 'acc-1' },
    ]);

    expect(result).toMatchObject({ accountsCreated: 1, accountsSkipped: 0 });
    const createdInstitution = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.find(([entity]) => (entity as { name?: string }).name === 'AccountFinancialInstitution')?.[1];
    expect(createdInstitution).toMatchObject({ id: 'enable_banking:pt:test-bank', provider: 'enable_banking' });
    expect(result.accounts[0]).toMatchObject({ accountId: 'acc-1', accountName: 'Checking', accountNumber: 'PT50000000000000000000000' });
    expect(result.accounts[0]?.enableBankingConnectionKey).toEqual(connection());
    expect(result.accounts[0]?.tenantKey).toEqual({ tenantKey: 3 });
  });

  it('skips a session account with no uid, without failing the batch', async () => {
    const em = createEm();
    const result = await createInitialEnableBankingAccounts(em as unknown as EntityManager, connection(), [{ currency: 'EUR', uid: undefined }, { currency: 'EUR', uid: 'acc-2' }]);
    expect(result.accountsSkipped).toBe(1);
    expect(result.accountsCreated).toBe(1);
    expect(result.skippedReasons[0]).toMatch(/missing uid/);
  });

  it('skips a session account with an unresolvable currency, without failing the batch', async () => {
    const em = createEm({ currency: null });
    const result = await createInitialEnableBankingAccounts(em as unknown as EntityManager, connection(), [{ currency: 'XXX', uid: 'acc-1' }]);
    expect(result.accountsSkipped).toBe(1);
    expect(result.accountsCreated).toBe(0);
    expect(result.skippedReasons[0]).toMatch(/unresolvable currency/);
  });

  it('undeletes a soft-deleted account instead of creating a duplicate', async () => {
    const existingDeleted = { accountId: 'acc-1', accountKey: 9, deletedAt: new Date() };
    const em = createEm({ existingDeleted, institution: { accountFinancialInstitutionKey: 1 } });
    const result = await createInitialEnableBankingAccounts(em as unknown as EntityManager, connection(), [{ currency: 'EUR', uid: 'acc-1' }]);
    expect(result.accountsCreated).toBe(1);
    expect(existingDeleted.deletedAt).toBeUndefined();
  });

  it('reloads and updates on a duplicate-key race instead of failing the batch', async () => {
    const em = createEm({ institution: { accountFinancialInstitutionKey: 1 }, persistRejects: [new UniqueConstraintViolationException(new Error('unique'))] });
    em.findOne.mockImplementation((entity: unknown, where: Record<string, unknown>) => {
      const name = (entity as { name?: string }).name;
      if (name === 'AccountFinancialInstitution') return { accountFinancialInstitutionKey: 1 };
      if (name === 'Currency') return { code: 'EUR' };
      if (name === 'Account') {
        if (Object.hasOwn(where, 'deletedAt') && (where['deletedAt'] as Record<string, unknown> | undefined)?.['$ne'] !== undefined) return null;
        return { accountId: 'acc-1', accountKey: 42 };
      }
      return null;
    });
    const result = await createInitialEnableBankingAccounts(em as unknown as EntityManager, connection(), [{ currency: 'EUR', uid: 'acc-1' }]);
    expect(result.accountsCreated).toBe(1);
    expect(result.accounts[0]).toMatchObject({ accountKey: 42 });
  });

  it('reuses an already-created institution rather than creating a second one', async () => {
    const em = createEm({ institution: { accountFinancialInstitutionKey: 1 } });
    await createInitialEnableBankingAccounts(em as unknown as EntityManager, connection(), [{ currency: 'EUR', uid: 'acc-1' }, { currency: 'EUR', uid: 'acc-2' }]);
    const institutionCreateCalls = (em.create as unknown as { mock: { calls: [unknown, unknown][] } }).mock.calls.filter(([entity]) => (entity as { name?: string }).name === 'AccountFinancialInstitution');
    expect(institutionCreateCalls).toHaveLength(0);
  });
});
