import type { AppleOptions } from 'better-auth/social-providers';

import { ConfigurationError } from '@config/configuration';

/**
 * Apple Sign-in subset of the validated auth configuration (`config.auth`).
 *
 * `null` is the "absent" value emitted by the configuration block, so both `null` and
 * `undefined` are treated as unset.
 */
export interface AppleAuthConfig {
  readonly appleClientId?: null | string;
  readonly appleClientSecret?: null | string;
  readonly appleNativeAudience?: null | string;
}

/**
 * Compatibility layer: callers may still pass a `process.env`-shaped object (uppercase keys),
 * e.g. the existing integration fixture, while new callers pass `config.auth`.
 */
export type AppleOptionsInput = AppleAuthConfig & {
  readonly APPLE_CLIENT_ID?: string;
  readonly APPLE_CLIENT_SECRET?: string;
  readonly APPLE_NATIVE_AUDIENCE?: string;
};

const appleError = (code: 'invalid-format' | 'missing', message: string, path: string): ConfigurationError =>
  new ConfigurationError('api', [{ code, message, path }]);

/** An explicit native audience; never derive this allowlist from untrusted token claims. */
export const configuredAppleOptions = (input: AppleOptionsInput = {}): AppleOptions | undefined => {
  const configuredClientId = input.appleClientId ?? input.APPLE_CLIENT_ID;
  const clientId = configuredClientId?.trim() || undefined;
  const clientSecret = input.appleClientSecret ?? input.APPLE_CLIENT_SECRET;
  const audience = input.appleNativeAudience ?? input.APPLE_NATIVE_AUDIENCE;
  if (audience !== undefined) {
    if (!/^[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(audience)) {
      throw appleError('invalid-format', 'APPLE_NATIVE_AUDIENCE must be an explicit Apple bundle identifier (no whitespace or wildcards).', 'APPLE_NATIVE_AUDIENCE');
    }
  }
  if (clientSecret && !clientId) {
    throw appleError('missing', 'APPLE_CLIENT_ID is required when APPLE_CLIENT_SECRET is configured.', 'APPLE_CLIENT_ID');
  }
  if (audience && clientSecret && clientId) {
    return { audience: [clientId, audience], clientId, clientSecret };
  }
  if (audience) {
    // Native idToken verification uses Apple's public keys and does not need a web secret.
    // Keep the allowlist pinned to the native bundle identifier, never the optional web ID.
    return { audience: [audience], clientId: clientId ?? audience };
  }
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
};
