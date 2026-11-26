import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * The signed-in person's own Enable Banking key. `GET /v1/user/enable-banking-credential` answers
 * null when they have none and never returns key material. `pending` is a key the server
 * generated, waiting for its application ID, and when it lapses; absent on an API older than
 * generated keys.
 */
const credentialObjectSchema = z.object({
  applicationId: z.string().nullable().optional(),
  pending: z.object({ expiresAt: z.string() }).nullable().optional().catch(undefined),
  status: tolerantEnum(['active', 'invalid', 'pending', 'revoked'], 'unknown'),
})

export const enableBankingCredentialSchema = credentialObjectSchema.nullable()

export type EnableBankingCredential = z.infer<typeof enableBankingCredentialSchema>

export const enableBankingCredentialEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/user/enable-banking-credential',
  schema: enableBankingCredentialSchema,
})

/**
 * `POST /v1/user/enable-banking-credential/certificate`: the server generates a key pair, keeps
 * the private key, and answers the public certificate (PEM) to register in the Control Panel.
 * Calling it again replaces a key still waiting for its application ID, never an active one.
 * Needs a fresh session, and the authenticator code when two-factor is on.
 */
const CERTIFICATE_BLOCK = /^\s*-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/

/**
 * Exactly one PEM certificate block. The app copies and shares this text, so anything else (a
 * private key above all) is refused as a drifted response rather than handed on.
 */
export const certificatePemSchema = z.string().refine(
  (value) => CERTIFICATE_BLOCK.test(value) && !value.includes('PRIVATE KEY'),
  'certificatePem must be one PEM certificate block',
)

export const enableBankingCertificateSchema = z.object({
  certificatePem: certificatePemSchema,
  expiresAt: z.string(),
})

export type EnableBankingCertificate = z.infer<typeof enableBankingCertificateSchema>

export const createEnableBankingCertificateEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/user/enable-banking-credential/certificate',
  schema: enableBankingCertificateSchema,
  successStatuses: [201],
})

/**
 * `POST /v1/user/enable-banking-credential/activate` with `{ applicationId }`: checks the
 * generated key against Enable Banking under that application and makes it the active key. A
 * wrong application answers 400 with its own code (`enable-banking-setup-view-model.ts`). Same
 * session and authenticator rules as the certificate.
 */
export const activateEnableBankingCredentialEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/user/enable-banking-credential/activate',
  // The credential's status, as `GET` answers it: written into the cache straight away.
  schema: credentialObjectSchema,
})
