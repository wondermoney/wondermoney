import { createHash } from 'node:crypto';

import type { AnalyticsEventProperties } from '@wondermoney/shared';

import { EnableBankingReturnTo } from '@app/types/enable-banking-return-to';
import { BankProviderError } from '@service/bank-providers/errors';
import { ERROR_CODE } from '@utils/errors';

export type BankConnectionFailureReason = AnalyticsEventProperties<'bank_connection_failed'>['reason'];

/**
 * A failed connection's `reason`, as one of the catalogue's fixed codes: a typed provider error's
 * own code, or SimpleFIN's claim errors. Never the provider's message.
 */
export function bankConnectionFailureReason(error: unknown): BankConnectionFailureReason {
  if (error instanceof BankProviderError) return error.incidentCode;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  switch (code) {
    case ERROR_CODE.BAD_GATEWAY:
      return 'provider_unavailable';
    case ERROR_CODE.SIMPLEFIN_SERVER_NOT_ALLOWED:
      return 'server_not_allowed';
    case ERROR_CODE.SIMPLEFIN_TOKEN_ALREADY_CLAIMED:
      return 'token_already_claimed';
    case ERROR_CODE.SIMPLEFIN_TOKEN_INVALID:
      return 'token_invalid';
    default:
      return 'unknown';
  }
}

/** The surface an Enable Banking connection was started from, stored on the connection. */
export function enableBankingPlatform(returnTo: EnableBankingReturnTo | null | undefined): 'mobile' | 'web' {
  return returnTo === EnableBankingReturnTo.MOBILE ? 'mobile' : 'web';
}

/**
 * The event id of a connection attempt's outcome, the same for completed and failed, so whichever
 * is recorded first stands. Hashed: the attempt's state is a secret of the consent flow.
 */
export function bankConnectionOutcomeEventId(state: string): string {
  return `bank_connection.v1:${createHash('sha256').update(`bank-connection:${state}`).digest('hex')}`;
}
