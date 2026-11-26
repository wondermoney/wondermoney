import { randomBytes, webcrypto } from 'node:crypto';

import * as x509 from '@peculiar/x509';

/** The subject and issuer of a certificate WonderMoney generates for Enable Banking. */
export const ENABLE_BANKING_CERTIFICATE_SUBJECT = 'CN=WonderMoney';

/** How long a generated certificate is valid: two years from the moment it is made. */
export const ENABLE_BANKING_CERTIFICATE_VALIDITY_YEARS = 2;

const RSA_MODULUS_BITS = 2048;

/**
 * Enable Banking signs nothing with the certificate: it reads the public key out of it to verify
 * the RS256 JWTs the application sends (https://enablebanking.com/docs/api/reference/, "Registering
 * an application"). So the algorithm is the one those JWTs use, RSASSA-PKCS1-v1_5 with SHA-256.
 */
const SIGNING_ALGORITHM = { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' } as const;

export interface GeneratedEnableBankingKeyPair {
  /** The self-signed X.509 certificate, PEM. Public: the person uploads it to Enable Banking. */
  certificatePem: string;
  notAfter: Date;
  /**
   * The PKCS#8 PEM private key. Secret: the caller encrypts it straight away
   * (`secret-encryption.service.ts`) and never logs, returns or exports it.
   */
  privateKeyPem: string;
}

x509.cryptoProvider.set(webcrypto);

/**
 * Generates a fresh RSA 2048 key pair and a self-signed certificate for it, subject and issuer
 * `CN=WonderMoney`, valid for two years. Node's own `crypto` generates keys but cannot issue a
 * certificate, which is what `@peculiar/x509` is for.
 */
export async function generateEnableBankingKeyPair(now: Date = new Date()): Promise<GeneratedEnableBankingKeyPair> {
  const keys = await webcrypto.subtle.generateKey(
    { ...SIGNING_ALGORITHM, modulusLength: RSA_MODULUS_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );

  const notBefore = new Date(now);
  const notAfter = new Date(now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + ENABLE_BANKING_CERTIFICATE_VALIDITY_YEARS);

  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
    ],
    keys,
    name: ENABLE_BANKING_CERTIFICATE_SUBJECT,
    notAfter,
    notBefore,
    serialNumber: positiveSerialNumber(),
    signingAlgorithm: SIGNING_ALGORITHM,
  });

  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);

  return {
    certificatePem: certificate.toString('pem'),
    notAfter,
    privateKeyPem: toPem(Buffer.from(pkcs8), 'PRIVATE KEY'),
  };
}

/** 16 random bytes as hex, with the top bit clear so the DER integer stays positive (RFC 5280, the serial number rules). */
function positiveSerialNumber(): string {
  const bytes = randomBytes(16);
  bytes[0] = (bytes[0] ?? 0) & 0x7f;
  return bytes.toString('hex');
}

function toPem(der: Buffer, label: string): string {
  const body = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}
