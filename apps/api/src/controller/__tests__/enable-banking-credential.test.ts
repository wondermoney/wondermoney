import { beforeEach, describe, expect, it, vi } from 'vitest';

const zParse = vi.hoisted(() => vi.fn());
const enableBankingCredentialService = vi.hoisted(() => ({
  deleteForAppuser: vi.fn(),
  getStatusForAppuser: vi.fn(),
}));

vi.mock('@app/validators/parser', () => ({ zParse }));
vi.mock('@service/enable-banking/enable-banking-credential.service', () => ({ enableBankingCredentialService }));

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { deleteEnableBankingCredential, getEnableBankingCredential } from '../enable-banking-credential';

describe('enable-banking-credential controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Saving a pasted key is covered against a stubbed Enable Banking, with a real database, in
  // `enable-banking-generated-key.http.test.ts` and `banking-instance-credential.http.test.ts`.

  describe('getEnableBankingCredential', () => {
    const req = Object.assign(mockReq(), { user: { appuserKey: 1 } });

    it('returns null when the user has no credential', async () => {
      enableBankingCredentialService.getStatusForAppuser.mockResolvedValueOnce(null);
      const json = vi.fn();

      await getEnableBankingCredential(req, mockRes({ json }));

      expect(enableBankingCredentialService.getStatusForAppuser).toHaveBeenCalledWith(1);
      expect(json).toHaveBeenCalledWith(null);
    });

    it('returns the credential status shape without key material when one exists', async () => {
      const status = { applicationId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', lastValidatedAt: '2027-01-01T00:00:00.000Z', lastValidationError: null, status: 'active' };
      enableBankingCredentialService.getStatusForAppuser.mockResolvedValueOnce(status);
      const json = vi.fn();

      await getEnableBankingCredential(req, mockRes({ json }));

      expect(json).toHaveBeenCalledWith(status);
    });
  });

  describe('deleteEnableBankingCredential', () => {
    it('is idempotent and always returns 204', async () => {
      enableBankingCredentialService.deleteForAppuser.mockResolvedValueOnce(undefined);
      const sendStatus = vi.fn();
      const req = Object.assign(mockReq(), { user: { appuserKey: 1 } });

      await deleteEnableBankingCredential(req, mockRes({ sendStatus }));

      expect(enableBankingCredentialService.deleteForAppuser).toHaveBeenCalledWith(1);
      expect(sendStatus).toHaveBeenCalledWith(204);
    });
  });
});
