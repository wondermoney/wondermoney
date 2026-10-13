import { z } from 'zod';

export const saveEnableBankingCredentialRequestSchema = z.object({
  body: z.object({
    applicationId: z.string().trim().min(1).max(255),
    // Enable Banking's downloaded/generated key is PKCS8 PEM; a coarse shape
    // check here gives a fast, clear 400 before we ever attempt to sign a JWT
    // or make a live provider call with something that obviously isn't a key.
    privateKeyPem: z
      .string()
      .min(1)
      .refine((value) => value.includes('-----BEGIN') && value.includes('PRIVATE KEY-----'), 'privateKeyPem must be a PEM-encoded private key'),
  }),
});
