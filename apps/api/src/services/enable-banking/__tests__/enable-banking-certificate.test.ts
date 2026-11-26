import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';

import { importX509, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { generateEnableBankingKeyPair } from '../enable-banking-certificate';
import { signEnableBankingJwt } from '../enable-banking-jwt.service';

/*
 * The certificate a person uploads to Enable Banking must carry the public half of the key the
 * server keeps, so that Enable Banking verifies every JWT the server signs for that application.
 */
describe('generateEnableBankingKeyPair', () => {
  it('issues a self-signed CN=WonderMoney certificate for an RSA 2048 key, valid for two years', async () => {
    const now = new Date('2026-11-26T12:00:00.000Z');
    const { certificatePem, notAfter } = await generateEnableBankingKeyPair(now);

    const certificate = new X509Certificate(certificatePem);
    expect(certificatePem.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
    expect(certificate.subject).toBe('CN=WonderMoney');
    expect(certificate.issuer).toBe('CN=WonderMoney');
    expect(certificate.verify(certificate.publicKey)).toBe(true);
    expect(certificate.publicKey.asymmetricKeyType).toBe('rsa');
    expect(certificate.publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(new Date(certificate.validFrom).toISOString()).toBe(now.toISOString());
    expect(new Date(certificate.validTo).toISOString()).toBe('2028-11-26T12:00:00.000Z');
    expect(notAfter.toISOString()).toBe('2028-11-26T12:00:00.000Z');
  });

  it("carries the public half of the private key it returns, so the server's JWTs verify against it", async () => {
    const { certificatePem, privateKeyPem } = await generateEnableBankingKeyPair();

    const fromPrivate = createPublicKey(createPrivateKey(privateKeyPem)).export({ format: 'der', type: 'spki' });
    const fromCertificate = new X509Certificate(certificatePem).publicKey.export({ format: 'der', type: 'spki' });
    expect(Buffer.compare(fromPrivate, fromCertificate)).toBe(0);

    const jwt = await signEnableBankingJwt('3fa85f64-5717-4562-b3fc-2c963f66afa6', privateKeyPem);
    const { protectedHeader } = await jwtVerify(jwt, await importX509(certificatePem, 'RS256'), { audience: 'api.enablebanking.com', issuer: 'enablebanking.com' });
    expect(protectedHeader).toMatchObject({ alg: 'RS256', kid: '3fa85f64-5717-4562-b3fc-2c963f66afa6' });
  });

  it('makes a new key pair and serial number each time', async () => {
    const first = await generateEnableBankingKeyPair();
    const second = await generateEnableBankingKeyPair();

    expect(first.privateKeyPem).not.toBe(second.privateKeyPem);
    expect(new X509Certificate(first.certificatePem).serialNumber).not.toBe(new X509Certificate(second.certificatePem).serialNumber);
  });
});
