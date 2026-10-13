import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { InternalServerError } from '@utils/errors';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const MASTER_KEY_LENGTH_BYTES = 32;

/** Bump when adding a new key version (e.g. after rotating to `_V2`). */
export const CURRENT_ENCRYPTION_KEY_VERSION = 1;

/**
 * Master key lookup keyed by version. Adding a future `CREDENTIAL_ENCRYPTION_KEY_V2`
 * only means adding a `2: process.env['CREDENTIAL_ENCRYPTION_KEY_V2']` entry here and
 * bumping `CURRENT_ENCRYPTION_KEY_VERSION` — no call site changes, and rows encrypted
 * under v1 keep decrypting correctly since `decryptSecret` looks the key up by the
 * `keyVersion` stored alongside the ciphertext.
 *
 * Read at module load time (not lazily) is intentional: it mirrors how the value would
 * be read anywhere else in this file, and the *use* of the value is still deferred to
 * `resolveMasterKey`, which is what actually throws when it's missing.
 */
const MASTER_KEYS: Record<number, string | undefined> = {
  1: process.env['CREDENTIAL_ENCRYPTION_KEY_V1'],
};

export interface EncryptedSecret {
  authTag: string;
  ciphertext: string;
  iv: string;
  keyVersion: number;
}

/**
 * AES-256-GCM encryption for small application secrets (BYOK provider credentials,
 * private keys, etc.) that must live in a text/varchar DB column rather than a KMS.
 *
 * The GCM authentication tag doubles as tamper detection: any bit flipped in the
 * ciphertext or the tag itself causes `decryptSecret` to throw rather than return
 * corrupted plaintext. Decrypted plaintext is meant to live in-process only, for the
 * duration of one call (e.g. sign a JWT, then discard) — never persisted or logged.
 */
export function decryptSecret(input: EncryptedSecret): string {
  const masterKey = resolveMasterKey(input.keyVersion);

  try {
    const decipher = createDecipheriv(ALGORITHM, masterKey, Buffer.from(input.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(input.authTag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(input.ciphertext, 'base64')), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    // Deliberately no upstream error message in the thrown error — a GCM auth-tag
    // failure means either tampering or a keyVersion/data mismatch, and neither
    // should risk echoing ciphertext/key material into logs or Sentry.
    throw new InternalServerError(`Failed to decrypt secret: authentication tag verification failed (keyVersion ${input.keyVersion}). Ciphertext may be tampered, corrupted, or encrypted under a different key.`);
  }
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const keyVersion = CURRENT_ENCRYPTION_KEY_VERSION;
  const masterKey = resolveMasterKey(keyVersion);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    keyVersion,
  };
}

function resolveMasterKey(keyVersion: number): Buffer {
  const envVarName = `CREDENTIAL_ENCRYPTION_KEY_V${keyVersion}`;
  const encodedKey = MASTER_KEYS[keyVersion];
  if (!encodedKey) {
    throw new InternalServerError(`${envVarName} environment variable not set`);
  }

  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== MASTER_KEY_LENGTH_BYTES) {
    throw new InternalServerError(`${envVarName} must decode to a ${MASTER_KEY_LENGTH_BYTES}-byte (256-bit) key, got ${key.length} bytes`);
  }

  return key;
}
