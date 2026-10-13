import { generateKeyPairSync } from 'node:crypto';

import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { ENABLE_BANKING_MAX_JWT_TTL_SECONDS, signEnableBankingJwt } from '../enable-banking-jwt.service';

const APPLICATION_ID = 'f69abd85-e14c-4f6f-8161-5549f5e188e3';

/** Throwaway RSA keypair generated fresh per test run — never a real credential. */
function generateTestKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

describe('signEnableBankingJwt', () => {
  it('produces a JWT with the header and claims shape Enable Banking requires', async () => {
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
    const ttlSeconds = 1_800;

    const jwt = await signEnableBankingJwt(APPLICATION_ID, privateKeyPem, ttlSeconds);
    expect(typeof jwt).toBe('string');
    expect(jwt.split('.')).toHaveLength(3);

    const header = decodeProtectedHeader(jwt);
    expect(header).toMatchObject({ alg: 'RS256', kid: APPLICATION_ID, typ: 'JWT' });

    const publicKey = await importSPKI(publicKeyPem, 'RS256');
    const { payload } = await jwtVerify(jwt, publicKey, {
      audience: 'api.enablebanking.com',
      issuer: 'enablebanking.com',
    });

    expect(payload.iss).toBe('enablebanking.com');
    expect(payload.aud).toBe('api.enablebanking.com');
    expect(payload.iat).toBeTypeOf('number');
    expect(payload.exp).toBeTypeOf('number');
    expect(payload.exp! - payload.iat!).toBe(ttlSeconds);
  });

  it('defaults to a 1 hour TTL when none is provided', async () => {
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();

    const jwt = await signEnableBankingJwt(APPLICATION_ID, privateKeyPem);

    const publicKey = await importSPKI(publicKeyPem, 'RS256');
    const { payload } = await jwtVerify(jwt, publicKey);
    expect(payload.exp! - payload.iat!).toBe(3_600);
  });

  it('rejects a ttlSeconds above the provider max of 86400', async () => {
    const { privateKeyPem } = generateTestKeyPair();

    await expect(signEnableBankingJwt(APPLICATION_ID, privateKeyPem, ENABLE_BANKING_MAX_JWT_TTL_SECONDS + 1)).rejects.toThrow(/exceeds the provider's maximum/i);
  });

  it('accepts a ttlSeconds exactly at the provider max', async () => {
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();

    const jwt = await signEnableBankingJwt(APPLICATION_ID, privateKeyPem, ENABLE_BANKING_MAX_JWT_TTL_SECONDS);

    const publicKey = await importSPKI(publicKeyPem, 'RS256');
    const { payload } = await jwtVerify(jwt, publicKey);
    expect(payload.exp! - payload.iat!).toBe(ENABLE_BANKING_MAX_JWT_TTL_SECONDS);
  });

  it('rejects a non-positive ttlSeconds', async () => {
    const { privateKeyPem } = generateTestKeyPair();

    await expect(signEnableBankingJwt(APPLICATION_ID, privateKeyPem, 0)).rejects.toThrow(/positive number/i);
    await expect(signEnableBankingJwt(APPLICATION_ID, privateKeyPem, -10)).rejects.toThrow(/positive number/i);
  });
});
