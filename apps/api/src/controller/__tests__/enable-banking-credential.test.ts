import { beforeEach, describe, expect, it, vi } from 'vitest';

const zParse = vi.hoisted(() => vi.fn());
const createEnableBankingClient = vi.hoisted(() => vi.fn());
const listInstitutions = vi.hoisted(() => vi.fn());
const enableBankingCredentialService = vi.hoisted(() => ({
  deleteForAppuser: vi.fn(),
  getStatusForAppuser: vi.fn(),
  saveValidatedCredential: vi.fn(),
}));
const captureException = vi.hoisted(() => vi.fn());

vi.mock('@app/validators/parser', () => ({ zParse }));
vi.mock('@service/enable-banking/enable-banking-client.service', () => ({ createEnableBankingClient }));
vi.mock('@service/enable-banking/enable-banking-credential.service', () => ({ enableBankingCredentialService }));
vi.mock('@sentry/node', () => ({ captureException }));

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { deleteEnableBankingCredential, getEnableBankingCredential, saveEnableBankingCredential } from '../enable-banking-credential';

describe('enable-banking-credential controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createEnableBankingClient.mockReturnValue({ listInstitutions });
  });

  describe('saveEnableBankingCredential', () => {
    const req = Object.assign(mockReq(), { tenant: { tenantKey: 99 }, user: { appuserKey: 1 } });

    it('validates the credential live, persists on success, and never returns key material', async () => {
      zParse.mockResolvedValueOnce({ body: { applicationId: 'app-123', privateKeyPem: 'pem-content' } });
      listInstitutions.mockResolvedValueOnce([{ country: 'PT', name: 'Bank A' }]);
      enableBankingCredentialService.saveValidatedCredential.mockResolvedValueOnce({
        applicationId: 'app-123',
        lastValidatedAt: '2027-01-01T00:00:00.000Z',
        lastValidationError: null,
        status: 'active',
      });
      const json = vi.fn();
      const res = mockRes({ json });

      await saveEnableBankingCredential(req, res);

      expect(createEnableBankingClient).toHaveBeenCalledWith({ applicationId: 'app-123', privateKeyPem: 'pem-content' });
      expect(listInstitutions).toHaveBeenCalledWith({});
      expect(enableBankingCredentialService.saveValidatedCredential).toHaveBeenCalledWith({
        applicationId: 'app-123',
        appuser: req.user,
        privateKeyPem: 'pem-content',
        tenant: req.tenant,
      });
      expect(json).toHaveBeenCalledWith({
        applicationId: 'app-123',
        lastValidatedAt: '2027-01-01T00:00:00.000Z',
        lastValidationError: null,
        status: 'active',
      });
      const responsePayload = json.mock.calls[0]?.[0] as unknown;
      expect(JSON.stringify(responsePayload)).not.toMatch(/pem-content|privateKey/i);
    });

    it('returns a 400 and persists nothing when live validation fails', async () => {
      zParse.mockResolvedValueOnce({ body: { applicationId: 'app-123', privateKeyPem: 'bad-pem' } });
      listInstitutions.mockRejectedValueOnce(new Error('Enable Banking credential is invalid or expired'));
      const res = mockRes({ json: vi.fn() });

      await expect(saveEnableBankingCredential(req, res)).rejects.toMatchObject({ status: 400 });

      expect(enableBankingCredentialService.saveValidatedCredential).not.toHaveBeenCalled();
      expect(captureException).toHaveBeenCalled();
    });

    it('never echoes the raw provider error message back to the caller', async () => {
      zParse.mockResolvedValueOnce({ body: { applicationId: 'app-123', privateKeyPem: 'bad-pem' } });
      listInstitutions.mockRejectedValueOnce(new Error('super secret internal provider detail'));
      const res = mockRes({ json: vi.fn() });

      await expect(saveEnableBankingCredential(req, res)).rejects.not.toMatchObject({ message: expect.stringContaining('super secret internal provider detail') });
    });
  });

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
      const status = { applicationId: 'app-123', lastValidatedAt: '2027-01-01T00:00:00.000Z', lastValidationError: null, status: 'active' };
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
