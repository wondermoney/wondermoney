import axios, { isAxiosError } from 'axios';

import { sanitizeProviderResponse } from '@utils/error-sanitizer';
import { BadGatewayError, BadRequestError, ForbiddenError, GatewayTimeoutError, InternalServerError, NotFoundError, TooManyRequestsError, UnauthorizedError } from '@utils/errors';
import logger from '@utils/logger';

import { signEnableBankingJwt } from './enable-banking-jwt.service';

/**
 * Confirmed against Enable Banking's live API reference
 * (https://enablebanking.com/docs/api/reference/) — `api.tilisy.com` is the
 * same API's deprecated legacy hostname, not used here.
 */
export const ENABLE_BANKING_BASE_URL = 'https://api.enablebanking.com';

const ENABLE_BANKING_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Enable Banking identifies a bank by `{name, country}`, not an opaque id
 * (see `AccountFinancialInstitution`'s `provider`-discriminated key in the
 * Phase 1a schema). Response shape is intentionally loose beyond the fields
 * this codebase actually reads today (`maximum_consent_validity` for the
 * real per-bank consent length) — see the API reference for the full shape.
 */
export interface CreateEnableBankingClientParams {
  applicationId: string;
  privateKeyPem: string;
}

export interface EnableBankingClient {
  exchangeSession(code: string): Promise<EnableBankingExchangeSessionResult>;
  getAccountBalances(accountId: string): Promise<unknown>;
  getAccountTransactions(accountId: string, params: EnableBankingTransactionsParams): Promise<unknown>;
  listInstitutions(params: { country?: string }): Promise<EnableBankingInstitution[]>;
  startAuthorization(params: EnableBankingStartAuthorizationParams): Promise<EnableBankingStartAuthorizationResult>;
}

export interface EnableBankingExchangeSessionResult {
  access: { validUntil: string };
  accounts: unknown[];
  sessionId: string;
}

export interface EnableBankingInstitution {
  [key: string]: unknown;
  country: string;
  logo?: string;
  maximum_consent_validity?: number;
  name: string;
}

export interface EnableBankingStartAuthorizationParams {
  aspsp: { country: string; name: string };
  psuType: 'business' | 'personal';
  redirectUrl: string;
  state: string;
  validUntil: string;
}

export interface EnableBankingStartAuthorizationResult {
  authorizationId: string;
  psuIdHash: string;
  url: string;
}

export interface EnableBankingTransactionsParams {
  continuationKey?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Low-level Enable Banking API client. Deliberately **not** shaped like the
 * `BankSyncClient` interface the sync services expect — `enable-banking-sync-adapter.ts`
 * is the seam that maps this client's Enable-Banking-native shapes onto the
 * `{account(id): {getDetails, getMetadata, getBalances, getTransactions}}` contract.
 *
 * Each call signs a fresh short-lived JWT (`signEnableBankingJwt`, default
 * 1h TTL) rather than caching one across calls — this client is expected to be
 * constructed per-request (see `enable-banking-credential.service.ts`), so
 * there is no long-lived instance for a cached token to usefully outlive.
 */
export function createEnableBankingClient({ applicationId, privateKeyPem }: CreateEnableBankingClientParams): EnableBankingClient {
  const httpClient = axios.create({
    baseURL: ENABLE_BANKING_BASE_URL,
    timeout: ENABLE_BANKING_REQUEST_TIMEOUT_MS,
  });

  async function authHeaders(): Promise<{ Authorization: string }> {
    const jwt = await signEnableBankingJwt(applicationId, privateKeyPem);
    return { Authorization: `Bearer ${jwt}` };
  }

  return {
    async exchangeSession(code) {
      const headers = await authHeaders();
      const { data } = await request<{
        access: { valid_until: string };
        accounts: unknown[];
        session_id: string;
      }>('exchangeSession', () => httpClient.post('/sessions', { code }, { headers }));

      return {
        access: { validUntil: data.access.valid_until },
        accounts: data.accounts,
        sessionId: data.session_id,
      };
    },

    async getAccountBalances(accountId) {
      const headers = await authHeaders();
      const { data } = await request('getAccountBalances', () => httpClient.get(`/accounts/${encodeURIComponent(accountId)}/balances`, { headers }));
      return data;
    },

    async getAccountTransactions(accountId, params) {
      const headers = await authHeaders();
      const { data } = await request('getAccountTransactions', () =>
        httpClient.get(`/accounts/${encodeURIComponent(accountId)}/transactions`, {
          headers,
          params: {
            continuation_key: params.continuationKey,
            date_from: params.dateFrom,
            date_to: params.dateTo,
          },
        }),
      );
      return data;
    },

    async listInstitutions(params) {
      const headers = await authHeaders();
      const { data } = await request<{ aspsps: EnableBankingInstitution[] }>('listInstitutions', () =>
        httpClient.get('/aspsps', { headers, params: { country: params.country } }),
      );
      return data.aspsps;
    },

    async startAuthorization(params) {
      const headers = await authHeaders();
      const { data } = await request<{ authorization_id: string; psu_id_hash: string; url: string }>('startAuthorization', () =>
        httpClient.post(
          '/auth',
          {
            access: { valid_until: params.validUntil },
            aspsp: { country: params.aspsp.country, name: params.aspsp.name },
            psu_type: params.psuType,
            redirect_url: params.redirectUrl,
            state: params.state,
          },
          { headers },
        ),
      );

      return {
        authorizationId: data.authorization_id,
        psuIdHash: data.psu_id_hash,
        url: data.url,
      };
    },
  };
}

/**
 * Runs one Enable Banking HTTP call, mapping a non-2xx response (or a
 * transport-level failure) to this app's typed errors instead of letting a raw
 * `AxiosError` escape — mirrors the pattern in `controller/banking.ts`'s
 * GoCardless call sites and `eodhd.service.ts`'s `handleEodhdError`.
 */
async function request<T = unknown>(operation: string, call: () => Promise<{ data: T }>): Promise<{ data: T }> {
  try {
    return await call();
  } catch (error) {
    const providerResponse = sanitizeProviderResponse(error);
    logger.warn({ enableBankingOperation: operation, providerResponse }, `Enable Banking API request failed: ${operation}`);

    if (!isAxiosError(error)) {
      throw new InternalServerError(`Unexpected error calling Enable Banking (${operation})`);
    }

    if (!error.response) {
      if (error.code === 'ECONNABORTED') {
        throw new GatewayTimeoutError('Enable Banking request timed out');
      }
      throw new BadGatewayError('Enable Banking is temporarily unavailable');
    }

    const { status } = error.response;
    if (status === 400) throw new BadRequestError('Enable Banking rejected the request');
    if (status === 401) throw new UnauthorizedError('Enable Banking credential is invalid or expired');
    if (status === 403) throw new ForbiddenError('Enable Banking rejected the request as forbidden');
    if (status === 404) throw new NotFoundError('Enable Banking resource not found');
    if (status === 429) {
      const retryAfterHeader = error.response.headers['retry-after'];
      const retryAfter = typeof retryAfterHeader === 'string' ? Number(retryAfterHeader) : undefined;
      throw new TooManyRequestsError('Enable Banking rate limit reached', Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    if (status >= 500) throw new BadGatewayError('Enable Banking is temporarily unavailable');
    throw new InternalServerError(`Unexpected Enable Banking response (${status})`);
  }
}
