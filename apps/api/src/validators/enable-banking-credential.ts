import { createPrivateKey } from 'node:crypto';

import { z } from 'zod';

/**
 * A PKCS#1 key (`BEGIN RSA PRIVATE KEY`, what `openssl genrsa` writes on older versions) rewritten
 * as PKCS#8, the form the JWT signer takes. Anything else is left as pasted: the signed test call
 * then answers for it.
 */
function toPkcs8(pem: string): string {
  if (!pem.includes('-----BEGIN RSA PRIVATE KEY-----')) return pem;
  try {
    return createPrivateKey(pem).export({ format: 'pem', type: 'pkcs8' });
  } catch {
    return pem;
  }
}

export const saveEnableBankingCredentialRequestSchema = z.object({
  body: z.object({
    applicationId: z.string().trim().min(1).max(255),
    // Enable Banking's downloaded/generated key is PKCS8 PEM; a coarse shape
    // check here gives a fast, clear 400 before we ever attempt to sign a JWT
    // or make a live provider call with something that obviously isn't a key.
    privateKeyPem: z
      .string()
      .min(1)
      .refine((value) => value.includes('-----BEGIN') && value.includes('PRIVATE KEY-----'), 'privateKeyPem must be a PEM-encoded private key')
      .transform(toPkcs8),
  }),
});

export const activateEnableBankingCredentialRequestSchema = z.object({
  body: z.object({
    // The UUID Enable Banking assigned the uploaded certificate. Its shape is checked with the
    // signed test call, so a mistyped one gets the same answer as an unknown one.
    applicationId: z.string().trim().min(1).max(255),
  }),
});
