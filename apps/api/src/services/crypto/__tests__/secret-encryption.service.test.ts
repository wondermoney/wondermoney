import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

const TEST_KEY_V1 = randomBytes(32).toString('base64');

async function loadModule(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) vi.stubEnv(key, value);
  }
  return import('../secret-encryption.service');
}

describe('secret-encryption.service', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips plaintext through encryptSecret -> decryptSecret', async () => {
    const { decryptSecret, encryptSecret } = await loadModule({ CREDENTIAL_ENCRYPTION_KEY_V1: TEST_KEY_V1 });
    const plaintext = '-----BEGIN PRIVATE KEY-----\nMIIExampleKeyMaterial\n-----END PRIVATE KEY-----';

    const encrypted = encryptSecret(plaintext);

    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.ciphertext).not.toContain('BEGIN PRIVATE KEY');
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it('produces different ciphertext/iv on each call (random iv, not deterministic)', async () => {
    const { encryptSecret } = await loadModule({ CREDENTIAL_ENCRYPTION_KEY_V1: TEST_KEY_V1 });

    const first = encryptSecret('same-plaintext');
    const second = encryptSecret('same-plaintext');

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('throws when the authTag has been tampered with', async () => {
    const { decryptSecret, encryptSecret } = await loadModule({ CREDENTIAL_ENCRYPTION_KEY_V1: TEST_KEY_V1 });
    const encrypted = encryptSecret('sensitive-value');
    const tamperedAuthTag = Buffer.from(encrypted.authTag, 'base64');
    tamperedAuthTag[0] = (tamperedAuthTag[0] ?? 0) ^ 0xff;

    expect(() => decryptSecret({ ...encrypted, authTag: tamperedAuthTag.toString('base64') })).toThrow(/decrypt/i);
  });

  it('throws when a ciphertext byte has been tampered with', async () => {
    const { decryptSecret, encryptSecret } = await loadModule({ CREDENTIAL_ENCRYPTION_KEY_V1: TEST_KEY_V1 });
    const encrypted = encryptSecret('another-sensitive-value');
    const tamperedCiphertext = Buffer.from(encrypted.ciphertext, 'base64');
    tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 0xff;

    expect(() => decryptSecret({ ...encrypted, ciphertext: tamperedCiphertext.toString('base64') })).toThrow(/decrypt/i);
  });

  it('does not swallow decryption failures with a generic/silent error', async () => {
    const { decryptSecret, encryptSecret } = await loadModule({ CREDENTIAL_ENCRYPTION_KEY_V1: TEST_KEY_V1 });
    const encrypted = encryptSecret('yet-another-value');
    const tamperedAuthTag = Buffer.from(encrypted.authTag, 'base64');
    tamperedAuthTag[0] = (tamperedAuthTag[0] ?? 0) ^ 0xff;

    let caught: unknown;
    try {
      decryptSecret({ ...encrypted, authTag: tamperedAuthTag.toString('base64') });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('InternalServerError');
  });

  it('throws a clear error naming the missing env var when the master key is not configured', async () => {
    const { encryptSecret } = await loadModule({ CREDENTIAL_ENCRYPTION_KEY_V1: undefined });

    expect(() => encryptSecret('anything')).toThrow('CREDENTIAL_ENCRYPTION_KEY_V1');
  });

  it('throws a clear error naming the missing env var on decrypt too', async () => {
    const { encryptSecret } = await loadModule({ CREDENTIAL_ENCRYPTION_KEY_V1: TEST_KEY_V1 });
    const encrypted = encryptSecret('value-encrypted-while-key-was-present');

    const { decryptSecret } = await loadModule({ CREDENTIAL_ENCRYPTION_KEY_V1: undefined });

    expect(() => decryptSecret(encrypted)).toThrow('CREDENTIAL_ENCRYPTION_KEY_V1');
  });
});
