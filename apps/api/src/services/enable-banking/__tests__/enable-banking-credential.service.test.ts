import { beforeEach, describe, expect, it, vi } from 'vitest';

const em = vi.hoisted(() => ({
  findOne: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  getReference: vi.fn((_entity: unknown, id: number) => ({ appuserKey: id })),
  persist: vi.fn().mockReturnThis(),
}));
const encryptSecret = vi.hoisted(() => vi.fn());
const decryptSecret = vi.hoisted(() => vi.fn());

vi.mock('@app/database/di', () => ({ DI: { em } }));
vi.mock('@service/crypto/secret-encryption.service', () => ({ decryptSecret, encryptSecret }));

import type { Appuser } from '@entity/Appuser';
import { type EnableBankingCredential, EnableBankingCredentialStatus } from '@entity/EnableBankingCredential';
import type { Tenant } from '@entity/Tenant';

import { EnableBankingCredentialService } from '../enable-banking-credential.service';

describe('EnableBankingCredentialService', () => {
  const appuser = { appuserKey: 1 } as unknown as Appuser;
  const tenant = { tenantKey: 99 } as unknown as Tenant;

  beforeEach(() => {
    em.findOne.mockReset();
    em.persist.mockReset().mockReturnThis();
    em.flush.mockReset().mockResolvedValue(undefined);
    em.getReference.mockReset().mockImplementation((_entity: unknown, id: number) => ({ appuserKey: id }));
    encryptSecret.mockReset().mockReturnValue({ authTag: 'tag', ciphertext: 'cipher', iv: 'iv', keyVersion: 1 });
    decryptSecret.mockReset().mockReturnValue('-----BEGIN PRIVATE KEY-----decrypted-----END PRIVATE KEY-----');
  });

  describe('saveValidatedCredential', () => {
    it('creates a new row when the user has no existing credential', async () => {
      em.findOne.mockResolvedValueOnce(null);
      const service = new EnableBankingCredentialService();

      const result = await service.saveValidatedCredential({ applicationId: 'app-123', appuser, privateKeyPem: 'pem-content', tenant });

      expect(encryptSecret).toHaveBeenCalledWith('pem-content');
      expect(em.persist).toHaveBeenCalled();
      const persistedRow = em.persist.mock.calls[0]?.[0];
      expect(persistedRow).toMatchObject({
        applicationId: 'app-123',
        appuserKey: appuser,
        encryptionKeyVersion: 1,
        privateKeyAuthTag: 'tag',
        privateKeyCiphertext: 'cipher',
        privateKeyIv: 'iv',
        status: EnableBankingCredentialStatus.ACTIVE,
        tenantKey: tenant,
      });
      expect(result).toMatchObject({ applicationId: 'app-123', status: EnableBankingCredentialStatus.ACTIVE });
      expect(result.lastValidatedAt).not.toBeNull();
    });

    it('updates the existing current row in place instead of stacking a new one', async () => {
      const existingRow = {
        applicationId: 'old-app-id',
        appuserKey: appuser,
        createdAt: new Date('2026-01-01'),
        deletedAt: undefined,
        encryptionKeyVersion: 1,
        lastValidatedAt: undefined,
        lastValidationError: 'old failure',
        privateKeyAuthTag: 'old-tag',
        privateKeyCiphertext: 'old-cipher',
        privateKeyIv: 'old-iv',
        status: EnableBankingCredentialStatus.INVALID,
      };
      em.findOne.mockResolvedValueOnce(existingRow);
      const service = new EnableBankingCredentialService();

      await service.saveValidatedCredential({ applicationId: 'new-app-id', appuser, privateKeyPem: 'new-pem', tenant });

      expect(em.persist).toHaveBeenCalledWith(existingRow);
      expect(existingRow).toMatchObject({
        applicationId: 'new-app-id',
        lastValidationError: undefined,
        status: EnableBankingCredentialStatus.ACTIVE,
      });
      expect(existingRow.lastValidatedAt).toBeInstanceOf(Date);
    });
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

  describe('deleteForAppuser', () => {
    it('is idempotent when no credential exists', async () => {
      em.findOne.mockResolvedValueOnce(null);
      const service = new EnableBankingCredentialService();

      await service.deleteForAppuser(1);

      expect(em.persist).not.toHaveBeenCalled();
    });

    it('is idempotent when the credential is already soft-deleted', async () => {
      em.findOne.mockResolvedValueOnce({ deletedAt: new Date() });
      const service = new EnableBankingCredentialService();

      await service.deleteForAppuser(1);

      expect(em.persist).not.toHaveBeenCalled();
    });

    it('soft-deletes the current row', async () => {
      const row: { deletedAt?: Date } = { deletedAt: undefined };
      em.findOne.mockResolvedValueOnce(row);
      const service = new EnableBankingCredentialService();

      await service.deleteForAppuser(1);

      expect(em.persist).toHaveBeenCalledWith(row);
      expect(row.deletedAt).toBeInstanceOf(Date);
    });
  });
});
