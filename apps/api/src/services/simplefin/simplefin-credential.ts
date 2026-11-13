import type { SimplefinConnection } from '@entity/SimplefinConnection';
import { decryptSecret, encryptSecret } from '@service/crypto/secret-encryption.service';

/**
 * The only code that turns a SimpleFIN access URL into ciphertext and back. The plaintext lives
 * for one request at a time and is never logged, returned or put in an error.
 */
export type SimplefinCredentialColumns = Pick<SimplefinConnection, 'accessUrlAuthTag' | 'accessUrlCiphertext' | 'accessUrlIv' | 'encryptionKeyVersion'>;

/** Thrown when the stored credential is gone (disconnected) or does not decrypt. */
export class SimplefinCredentialUnavailableError extends Error {
  constructor() {
    super('The SimpleFIN access for this connection is not available');
    this.name = 'SimplefinCredentialUnavailableError';
  }
}

/**
 * Throws when this instance cannot encrypt (no `CREDENTIAL_ENCRYPTION_KEY_V1`). Checked before a
 * setup token is claimed: a token works once, so a claim whose result cannot be stored wastes it.
 */
export function assertCredentialStorageAvailable(): void {
  encryptSecret('simplefin-storage-check');
}

export function decryptAccessUrl(row: SimplefinCredentialColumns): string {
  const { accessUrlAuthTag, accessUrlCiphertext, accessUrlIv, encryptionKeyVersion } = row;
  if (!accessUrlAuthTag || !accessUrlCiphertext || !accessUrlIv || !encryptionKeyVersion) throw new SimplefinCredentialUnavailableError();
  try {
    return decryptSecret({ authTag: accessUrlAuthTag, ciphertext: accessUrlCiphertext, iv: accessUrlIv, keyVersion: encryptionKeyVersion });
  } catch {
    throw new SimplefinCredentialUnavailableError();
  }
}

export function encryptAccessUrl(accessUrl: string): Required<{ [K in keyof SimplefinCredentialColumns]: NonNullable<SimplefinCredentialColumns[K]> }> {
  const encrypted = encryptSecret(accessUrl);
  return {
    accessUrlAuthTag: encrypted.authTag,
    accessUrlCiphertext: encrypted.ciphertext,
    accessUrlIv: encrypted.iv,
    encryptionKeyVersion: encrypted.keyVersion,
  };
}

/** Destroys the stored credential, for a disconnect. */
export function wipeAccessUrl(row: SimplefinCredentialColumns): void {
  row.accessUrlAuthTag = null;
  row.accessUrlCiphertext = null;
  row.accessUrlIv = null;
  row.encryptionKeyVersion = null;
}
