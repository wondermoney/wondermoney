import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InstanceEnableBankingCredentialError, loadInstanceEnableBankingCredential } from '../enable-banking-instance';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PKCS8_PEM = rsa.privateKey.export({ format: 'pem', type: 'pkcs8' });
const PKCS1_PEM = rsa.privateKey.export({ format: 'pem', type: 'pkcs1' });
const EC_PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' });
/** A line from the middle of the key: if it shows up anywhere, the key leaked. */
const KEY_BODY = PKCS8_PEM.split('\n')[5] ?? '';

const KEY_FILE = '/run/secrets/enable_banking_private_key';
const filesAt = (files: Record<string, string>) => (path: string) => {
  const content = files[path];
  if (content === undefined) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });
  return content;
};

function loadError(source: Record<string, string>, readFile = filesAt({})): InstanceEnableBankingCredentialError {
  try {
    loadInstanceEnableBankingCredential(source, readFile);
  } catch (error) {
    if (error instanceof InstanceEnableBankingCredentialError) return error;
    throw error;
  }
  throw new Error('expected the instance credential to be refused');
}

describe('the instance-wide Enable Banking credential', () => {
  it('is off when neither variable is set, or both are blank', () => {
    expect(loadInstanceEnableBankingCredential({}, filesAt({}))).toBeNull();
    expect(loadInstanceEnableBankingCredential({ ENABLE_BANKING_APP_ID: ' ', ENABLE_BANKING_PRIVATE_KEY_FILE: '' }, filesAt({}))).toBeNull();
  });

  it('reads the application id and the private key from the mounted file', () => {
    const credential = loadInstanceEnableBankingCredential(
      { ENABLE_BANKING_APP_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY_FILE: KEY_FILE },
      filesAt({ [KEY_FILE]: PKCS8_PEM }),
    );

    expect(credential?.applicationId).toBe('app-123');
    expect(credential?.privateKeyPem).toContain('BEGIN PRIVATE KEY');
  });

  it('accepts a PKCS#1 key and hands it on as PKCS#8, the format the JWT signer reads', () => {
    const credential = loadInstanceEnableBankingCredential(
      { ENABLE_BANKING_APP_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY_FILE: KEY_FILE },
      filesAt({ [KEY_FILE]: PKCS1_PEM }),
    );

    expect(credential?.privateKeyPem).toContain('BEGIN PRIVATE KEY');
  });

  it('refuses one variable without the other', () => {
    expect(loadError({ ENABLE_BANKING_APP_ID: 'app-123' }).message).toMatch(/ENABLE_BANKING_PRIVATE_KEY_FILE/);
    expect(loadError({ ENABLE_BANKING_PRIVATE_KEY_FILE: KEY_FILE }).message).toMatch(/ENABLE_BANKING_APP_ID/);
  });

  it('names the file it could not read', () => {
    const error = loadError({ ENABLE_BANKING_APP_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY_FILE: KEY_FILE });

    expect(error.message).toContain(KEY_FILE);
    expect(error.message).toContain('ENOENT');
  });

  it.each([
    ['a certificate instead of the key', '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n'],
    ['an empty file', ''],
    ['a public key', rsa.publicKey.export({ format: 'pem', type: 'spki' })],
    ['an elliptic-curve key (Enable Banking signs with RS256)', EC_PEM],
  ])('refuses %s', (_label, content) => {
    const error = loadError({ ENABLE_BANKING_APP_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY_FILE: KEY_FILE }, filesAt({ [KEY_FILE]: content }));

    expect(error.message).toContain(KEY_FILE);
  });

  it('never repeats the file\'s contents in an error', () => {
    const corrupted = PKCS8_PEM.replace('BEGIN PRIVATE KEY', 'BEGIN PRIVATE KEX');
    const error = loadError({ ENABLE_BANKING_APP_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY_FILE: KEY_FILE }, filesAt({ [KEY_FILE]: corrupted }));

    expect(JSON.stringify({ message: error.message, stack: error.stack })).not.toContain(KEY_BODY);
  });
});
