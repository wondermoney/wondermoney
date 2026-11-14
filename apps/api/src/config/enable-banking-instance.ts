import { createPrivateKey, type KeyObject } from 'node:crypto';

import { readSecretFile } from '@utils/read-secret-file';

/**
 * The operator's own Enable Banking application, shared by the instance: `ENABLE_BANKING_APP_ID`
 * plus `ENABLE_BANKING_PRIVATE_KEY_FILE`, the path of the application's private key. Optional:
 * with neither set, every user brings their own credential.
 *
 * The key is read from a file so it can be a Docker or Kubernetes secret rather than an
 * environment variable. It is never logged, returned or stored: errors name the file, never its
 * contents. The start-up check (`config/env.ts`) refuses a broken one; the running process reads
 * it through `services/enable-banking/instance-credential.ts`.
 */

export type InstanceCredentialSource = Readonly<Record<string, string | undefined>>;

export interface InstanceEnableBankingCredential {
  applicationId: string;
  privateKeyPem: string;
}

export class InstanceEnableBankingCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstanceEnableBankingCredentialError';
  }
}

/**
 * Read and check the instance credential: null when it is not configured, the credential when
 * it is, and an {@link InstanceEnableBankingCredentialError} when it is configured but unusable
 * (one variable without the other, an unreadable file, or a file that is not an RSA private key).
 *
 * The key comes back as PKCS#8 PEM, the format the JWT signer reads, whichever PEM form the file
 * holds.
 */
export function loadInstanceEnableBankingCredential(
  source: InstanceCredentialSource,
  readFile: (path: string) => string = readSecretFile,
): InstanceEnableBankingCredential | null {
  const applicationId = source['ENABLE_BANKING_APP_ID']?.trim() || undefined;
  const keyFile = source['ENABLE_BANKING_PRIVATE_KEY_FILE']?.trim() || undefined;
  if (!applicationId && !keyFile) return null;
  if (!applicationId) {
    throw new InstanceEnableBankingCredentialError('ENABLE_BANKING_APP_ID is required when ENABLE_BANKING_PRIVATE_KEY_FILE is set: the two turn the instance-wide Enable Banking credential on together');
  }
  if (!keyFile) {
    throw new InstanceEnableBankingCredentialError('ENABLE_BANKING_PRIVATE_KEY_FILE is required when ENABLE_BANKING_APP_ID is set: the path of the Enable Banking application\'s private key file');
  }

  let pem: string;
  try {
    pem = readFile(keyFile);
  } catch (error) {
    const code = (error as null | { code?: unknown })?.code;
    throw new InstanceEnableBankingCredentialError(
      `ENABLE_BANKING_PRIVATE_KEY_FILE: cannot read ${keyFile}${typeof code === 'string' ? ` (${code})` : ''}. Mount the Enable Banking application's private key there, readable by the user the container runs as`,
    );
  }

  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new InstanceEnableBankingCredentialError(
      `ENABLE_BANKING_PRIVATE_KEY_FILE: ${keyFile} is not a PEM private key. Use the private key you generated when you registered the Enable Banking application, not its certificate`,
    );
  }
  if (key.asymmetricKeyType !== 'rsa') {
    throw new InstanceEnableBankingCredentialError(`ENABLE_BANKING_PRIVATE_KEY_FILE: ${keyFile} must hold an RSA private key (Enable Banking signs with RS256)`);
  }

  return { applicationId, privateKeyPem: key.export({ format: 'pem', type: 'pkcs8' }) };
}

/** Every problem with the configured instance credential, for the start-up check. Empty when it is fine or off. */
export function instanceEnableBankingCredentialProblems(source: InstanceCredentialSource, readFile?: (path: string) => string): string[] {
  try {
    loadInstanceEnableBankingCredential(source, readFile);
    return [];
  } catch (error) {
    if (error instanceof InstanceEnableBankingCredentialError) return [error.message];
    throw error;
  }
}

/**
 * `ENABLE_BANKING_PRODUCTION_CONTRACT`: the operator says their Enable Banking application has a
 * full production contract, so it may link anyone's accounts and the single-household limit is
 * lifted. Off unless set to a true value.
 */
export function hasEnableBankingProductionContract(env: InstanceCredentialSource = process.env): boolean {
  const value = env['ENABLE_BANKING_PRODUCTION_CONTRACT']?.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}
