import { importPKCS8, SignJWT } from 'jose';

import { BadRequestError } from '@utils/errors';

/**
 * Enable Banking's own documented ceiling: "Maximum allowed time-to-live for
 * token is 86400 seconds (24 hours). Tokens created with longer TTL are not
 * accepted by the API." (https://enablebanking.com/docs/api/reference/).
 */
export const ENABLE_BANKING_MAX_JWT_TTL_SECONDS = 86_400;

const ENABLE_BANKING_ISSUER = 'enablebanking.com';
const ENABLE_BANKING_AUDIENCE = 'api.enablebanking.com';
const DEFAULT_JWT_TTL_SECONDS = 3_600;

/**
 * Signs a short-lived RS256 JWT for authenticating against the Enable Banking
 * API, using a user's own BYOK application credential (`applicationId` as the
 * `kid`, their uploaded certificate's private key to sign).
 *
 * `privateKeyPem` is decrypted, in-process, application-secret material —
 * callers must never log it or let it escape this call (see
 * `services/crypto/secret-encryption.service.ts` and `utils/logger.ts`'s
 * `redact` config).
 */
export async function signEnableBankingJwt(applicationId: string, privateKeyPem: string, ttlSeconds: number = DEFAULT_JWT_TTL_SECONDS): Promise<string> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new BadRequestError('Enable Banking JWT ttlSeconds must be a positive number');
  }
  if (ttlSeconds > ENABLE_BANKING_MAX_JWT_TTL_SECONDS) {
    throw new BadRequestError(`Enable Banking JWT ttlSeconds (${ttlSeconds}) exceeds the provider's maximum of ${ENABLE_BANKING_MAX_JWT_TTL_SECONDS} seconds`);
  }

  const privateKey = await importPKCS8(privateKeyPem, 'RS256');

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: applicationId, typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(ENABLE_BANKING_ISSUER)
    .setAudience(ENABLE_BANKING_AUDIENCE)
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(privateKey);
}
