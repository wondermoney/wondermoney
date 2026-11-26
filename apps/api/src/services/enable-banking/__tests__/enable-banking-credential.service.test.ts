import { beforeEach, describe, expect, it, vi } from 'vitest';

const em = vi.hoisted(() => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  getReference: vi.fn((_entity: unknown, id: number) => ({ appuserKey: id })),
  persist: vi.fn().mockReturnThis(),
  remove: vi.fn(),
}));
const decryptSecret = vi.hoisted(() => vi.fn());

vi.mock('@app/database/di', () => ({ DI: { em } }));
vi.mock('@service/crypto/secret-encryption.service', () => ({ decryptSecret, encryptSecret: vi.fn() }));

import { type EnableBankingCredential, EnableBankingCredentialStatus } from '@entity/EnableBankingCredential';

import { EnableBankingCredentialService } from '../enable-banking-credential.service';

describe('EnableBankingCredentialService', () => {
  beforeEach(() => {
    em.findOne.mockReset();
    em.find.mockReset().mockResolvedValue([]);
    em.remove.mockReset();
    em.persist.mockReset().mockReturnThis();
    em.flush.mockReset().mockResolvedValue(undefined);
    em.getReference.mockReset().mockImplementation((_entity: unknown, id: number) => ({ appuserKey: id }));
    decryptSecret.mockReset().mockReturnValue('-----BEGIN PRIVATE KEY-----decrypted-----END PRIVATE KEY-----');
  });

  describe('getStatusForAppuser', () => {
    it('returns null when no credential row exists', async () => {
      em.findOne.mockResolvedValueOnce(null);
      const service = new EnableBankingCredentialService();

      await expect(service.getStatusForAppuser(1)).resolves.toBeNull();
    });

    it('returns the status shape without key material when a row exists', async () => {
      em.findOne.mockResolvedValueOnce({
        applicationId: 'app-123',
        lastValidatedAt: new Date('2027-01-01T00:00:00.000Z'),
        lastValidationError: null,
        privateKeyCiphertext: 'should-not-appear',
        status: EnableBankingCredentialStatus.ACTIVE,
      });
      const service = new EnableBankingCredentialService();

      const status = await service.getStatusForAppuser(1);

      expect(status).toEqual({
        applicationId: 'app-123',
        lastValidatedAt: '2027-01-01T00:00:00.000Z',
        lastValidationError: null,
        pending: null,
        status: EnableBankingCredentialStatus.ACTIVE,
      });
    });
  });

  describe('getDecryptedCredential', () => {
    it('returns null when there is no active credential', async () => {
      em.findOne.mockResolvedValueOnce(null);
      const service = new EnableBankingCredentialService();

      await expect(service.getDecryptedCredential(1)).resolves.toBeNull();
      expect(em.findOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: EnableBankingCredentialStatus.ACTIVE }),
        expect.anything(),
      );
    });

    it('decrypts and returns the plaintext credential for an active row', async () => {
      em.findOne.mockResolvedValueOnce({
        applicationId: 'app-123',
        encryptionKeyVersion: 1,
        privateKeyAuthTag: 'tag',
        privateKeyCiphertext: 'cipher',
        privateKeyIv: 'iv',
        status: EnableBankingCredentialStatus.ACTIVE,
      });
      const service = new EnableBankingCredentialService();

      const credential = await service.getDecryptedCredential(1);

      expect(decryptSecret).toHaveBeenCalledWith({ authTag: 'tag', ciphertext: 'cipher', iv: 'iv', keyVersion: 1 });
      expect(credential).toEqual({ applicationId: 'app-123', privateKeyPem: '-----BEGIN PRIVATE KEY-----decrypted-----END PRIVATE KEY-----' });
    });
  });

  describe('decryptCredentialEntity', () => {
    it('decrypts an already-loaded entity without a DB round-trip', () => {
      const service = new EnableBankingCredentialService();
      const credential = {
        applicationId: 'app-123',
        encryptionKeyVersion: 1,
        privateKeyAuthTag: 'tag',
        privateKeyCiphertext: 'cipher',
        privateKeyIv: 'iv',
      } as unknown as EnableBankingCredential;

      const result = service.decryptCredentialEntity(credential);

      expect(em.findOne).not.toHaveBeenCalled();
      expect(decryptSecret).toHaveBeenCalledWith({ authTag: 'tag', ciphertext: 'cipher', iv: 'iv', keyVersion: 1 });
      expect(result).toEqual({ applicationId: 'app-123', privateKeyPem: '-----BEGIN PRIVATE KEY-----decrypted-----END PRIVATE KEY-----' });
    });
  });

  describe('getActiveCredentialEntity', () => {
    it('returns null when there is no active credential', async () => {
      em.findOne.mockResolvedValueOnce(null);
      const service = new EnableBankingCredentialService();

      await expect(service.getActiveCredentialEntity(1)).resolves.toBeNull();
      expect(em.findOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: EnableBankingCredentialStatus.ACTIVE }),
        expect.anything(),
      );
    });

    it('returns the entity itself (not decrypted) for an active row', async () => {
      const credentialRow = { applicationId: 'app-123', privateKeyCiphertext: 'still-encrypted', status: EnableBankingCredentialStatus.ACTIVE };
      em.findOne.mockResolvedValueOnce(credentialRow);
      const service = new EnableBankingCredentialService();

      const result = await service.getActiveCredentialEntity(1);

      expect(result).toBe(credentialRow);
      expect(decryptSecret).not.toHaveBeenCalled();
    });
  });
});
