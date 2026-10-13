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

  it('returns undefined when no linked connection is expiring', async () => {
    findOne.mockResolvedValueOnce(null);
    await expect(buildConsentExpiringData(em, appuser, 'EN')).resolves.toBeUndefined();
  });

  it('names the bank and the expiry date of the soonest-expiring connection', async () => {
    const connection = { accessValidUntil: new Date('2026-08-10T00:00:00.000Z'), aspspName: 'Banco Exemplo' };
    findOne.mockResolvedValue(connection);
    await expect(buildConsentExpiringData(em, appuser, 'EN')).resolves.toEqual({ bankName: 'Banco Exemplo', expiryDate: '10 August' });
    await expect(buildConsentExpiringData(em, appuser, 'PT')).resolves.toEqual({ bankName: 'Banco Exemplo', expiryDate: '10 de agosto' });
  });
});
