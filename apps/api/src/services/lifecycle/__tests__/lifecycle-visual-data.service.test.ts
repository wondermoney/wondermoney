import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Appuser } from '@entity/Appuser';
import { buildConsentExpiringData } from '@service/lifecycle/lifecycle-visual-data.service';

const appuser = { appuserKey: 7 } as Appuser;

describe('lifecycle-visual-data.service buildConsentExpiringData', () => {
  const findOne = vi.fn();
  const em = { findOne, getReference: vi.fn() } as unknown as import('@mikro-orm/core').EntityManager;

  beforeEach(() => {
    findOne.mockReset();
  });

  it('returns undefined when no linked requisition is expiring', async () => {
    findOne.mockResolvedValueOnce(null);
    await expect(buildConsentExpiringData(em, appuser, 'EN')).resolves.toBeUndefined();
  });

  it('includes the real bank name when a linked account resolves one', async () => {
    findOne
      .mockResolvedValueOnce({ expiresAt: new Date('2026-08-10T00:00:00.000Z'), nordigenRequisitionKey: 5 })
      .mockResolvedValueOnce({ accountFinancialInstitutionKey: { displayName: 'Banco Exemplo', name: 'banco-exemplo' } });
    await expect(buildConsentExpiringData(em, appuser, 'EN')).resolves.toEqual({
      bankName: 'Banco Exemplo',
      expiryDate: '10 August',
    });
  });

  it('falls back to no bank name when the connection has no linked account', async () => {
    findOne
      .mockResolvedValueOnce({ expiresAt: new Date('2026-08-10T00:00:00.000Z'), nordigenRequisitionKey: 5 })
      .mockResolvedValueOnce(null);
    await expect(buildConsentExpiringData(em, appuser, 'EN')).resolves.toEqual({
      bankName: undefined,
      expiryDate: '10 August',
    });
  });
});
