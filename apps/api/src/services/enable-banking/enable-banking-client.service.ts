import axios, { isAxiosError } from 'axios';

import { sanitizeProviderResponse } from '@utils/error-sanitizer';
import { BadGatewayError, BadRequestError, ForbiddenError, GatewayTimeoutError, InternalServerError, NotFoundError, TooManyRequestsError, UnauthorizedError, UnprocessableEntityError } from '@utils/errors';
import logger from '@utils/logger';

import { type EnableBankingErrorInfo, loggableEnableBankingBody, readEnableBankingError } from './enable-banking-error';
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
 * (see `AccountFinancialInstitution`'s `provider`-discriminated key). Response shape is intentionally loose beyond the fields
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
  getApplication(): Promise<EnableBankingApplication>;
  getSession(sessionId: string): Promise<EnableBankingSessionResult>;
  listInstitutions(params: { country?: string }): Promise<EnableBankingInstitution[]>;
  startAuthorization(params: EnableBankingStartAuthorizationParams): Promise<EnableBankingStartAuthorizationResult>;
}

/**
 * `GET /application`: the application the JWT's `kid` names, as Enable Banking sees it.
 * `environment` is `PRODUCTION` or `SANDBOX`, undefined when the answer does not say. Its `active`
 * flag is not read: a Restricted Production application activated by linking its owner's accounts
 * is not known to report it.
 */
export interface EnableBankingApplication {
  environment?: string;
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

/**
 * `GET /sessions/{session_id}`. `status` is Enable Banking's `SessionStatus`: `AUTHORIZED` while the
 * consent holds, otherwise one of `CANCELLED`, `CLOSED`, `EXPIRED`, `INVALID`,
 * `PENDING_AUTHORIZATION`, `RETURNED_FROM_BANK` or `REVOKED`.
 */
export interface EnableBankingSessionResult {
  status: string;
  validUntil?: string;
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

    async getApplication() {
      const headers = await authHeaders();
      const { data } = await request<null | { environment?: unknown }>('getApplication', () => httpClient.get('/application', { headers }));
      const environment = data && typeof data === 'object' && typeof data.environment === 'string' ? data.environment : undefined;
      return environment === undefined ? {} : { environment };
    },

    async getSession(sessionId) {
      const headers = await authHeaders();
      const { data } = await request<{ access?: { valid_until?: string }; status: string }>('getSession', () =>
        httpClient.get(`/sessions/${encodeURIComponent(sessionId)}`, { headers }),
      );
      return { status: data.status, validUntil: data.access?.valid_until };
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
 * `AxiosError` escape — mirrors `eodhd.service.ts`'s `handleEodhdError`.
 *
 * The thrown error carries `enableBankingError` (see {@link EnableBankingErrorInfo}), so a caller
 * can branch on Enable Banking's own code and log it; the typed error's message stays ours.
 */
function mapRequestError(operation: string, error: unknown): Error {
  if (!isAxiosError(error)) {
    return new InternalServerError(`Unexpected error calling Enable Banking (${operation})`);
  }

  if (!error.response) {
    if (error.code === 'ECONNABORTED') {
      return new GatewayTimeoutError('Enable Banking request timed out');
    }
    return new BadGatewayError('Enable Banking is temporarily unavailable');
  }

  const { status } = error.response;
  if (status === 400) return new BadRequestError('Enable Banking rejected the request');
  if (status === 401) return new UnauthorizedError('Enable Banking credential is invalid or expired');
  if (status === 403) return new ForbiddenError('Enable Banking rejected the request as forbidden');
  if (status === 404) return new NotFoundError('Enable Banking resource not found');
  if (status === 429) {
    return new TooManyRequestsError('Enable Banking rate limit reached', parseRetryAfter(error.response.headers['retry-after']));
  }
  if (status >= 500) return new BadGatewayError('Enable Banking is temporarily unavailable');
  // A refused transaction period is retried with a shorter window (`enable-banking-sync-adapter.ts`),
  // so it is not an unexpected response, and not logged as an error.
  if (readEnableBankingError(status, error.response.data).code === 'WRONG_TRANSACTIONS_PERIOD') {
    return new UnprocessableEntityError('Enable Banking refused the transaction period');
  }
  return new InternalServerError(`Unexpected Enable Banking response (${status})`);
}

async function request<T = unknown>(operation: string, call: () => Promise<{ data: T }>): Promise<{ data: T }> {
  try {
    return await call();
  } catch (error) {
    const response = isAxiosError(error) ? error.response : undefined;
    const providerResponse = response ? sanitizeProviderResponse({ response: { data: loggableEnableBankingBody(response.data), status: response.status } }) : undefined;
    const enableBankingError = response ? readEnableBankingError(response.status, response.data) : undefined;
    logger.warn({ enableBankingError, enableBankingOperation: operation, providerResponse }, `Enable Banking API request failed: ${operation}`);
    throw withEnableBankingError(mapRequestError(operation, error), enableBankingError);
  }
}

function withEnableBankingError(error: Error, info: EnableBankingErrorInfo | undefined): Error {
  return info ? Object.assign(error, { enableBankingError: info }) : error;
}

/** `Retry-After` is either delay-seconds or an HTTP-date (RFC 9110, section 10.2.3). */
function parseRetryAfter(header: unknown): number | undefined {
  if (typeof header !== 'string' || header.trim() === '') return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds : undefined;
  const at = Date.parse(header);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}
