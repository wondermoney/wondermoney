import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  signEnableBankingJwt: vi.fn(),
}));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: vi.fn(() => ({
        get: mocks.get,
        post: mocks.post,
      })),
    },
  };
});

vi.mock('../enable-banking-jwt.service', () => ({
  signEnableBankingJwt: mocks.signEnableBankingJwt,
}));

function importClient() {
  return import('../enable-banking-client.service');
}

describe('createEnableBankingClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signEnableBankingJwt.mockResolvedValue('signed.jwt.token');
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('sends a Bearer JWT authorization header signed with the credential', async () => {
    const { createEnableBankingClient } = await importClient();
    mocks.get.mockResolvedValueOnce({ data: { aspsps: [] } });

    const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });
    await client.listInstitutions({ country: 'PT' });

    expect(mocks.signEnableBankingJwt).toHaveBeenCalledWith('app-123', 'test-pem');
    expect(mocks.get).toHaveBeenCalledWith('/aspsps', {
      headers: { Authorization: 'Bearer signed.jwt.token' },
      params: { country: 'PT' },
    });
  });

  it('listInstitutions hits GET /aspsps with the country query param and unwraps the aspsps array', async () => {
    const { createEnableBankingClient } = await importClient();
    const institutions = [{ country: 'PT', maximum_consent_validity: 15_552_000, name: 'Bank A' }];
    mocks.get.mockResolvedValueOnce({ data: { aspsps: institutions } });

    const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });
    const result = await client.listInstitutions({ country: 'PT' });

    expect(result).toEqual(institutions);
  });

  it('startAuthorization posts the snake_case Enable Banking shape and maps the camelCase response', async () => {
    const { createEnableBankingClient } = await importClient();
    mocks.post.mockResolvedValueOnce({
      data: { authorization_id: 'auth-1', psu_id_hash: 'hash-1', url: 'https://auth.enablebanking.com/start' },
    });

    const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });
    const result = await client.startAuthorization({
      aspsp: { country: 'PT', name: 'Bank A' },
      psuType: 'personal',
      redirectUrl: 'https://api.wonder.money/v1/banking/enable-banking/callback',
      state: 'state-123',
      validUntil: '2027-01-01T00:00:00Z',
    });

    expect(mocks.post).toHaveBeenCalledWith(
      '/auth',
      {
        access: { valid_until: '2027-01-01T00:00:00Z' },
        aspsp: { country: 'PT', name: 'Bank A' },
        psu_type: 'personal',
        redirect_url: 'https://api.wonder.money/v1/banking/enable-banking/callback',
        state: 'state-123',
      },
      { headers: { Authorization: 'Bearer signed.jwt.token' } },
    );
    expect(result).toEqual({ authorizationId: 'auth-1', psuIdHash: 'hash-1', url: 'https://auth.enablebanking.com/start' });
  });

  it('exchangeSession posts the code and maps session_id/access.valid_until to camelCase', async () => {
    const { createEnableBankingClient } = await importClient();
    mocks.post.mockResolvedValueOnce({
      data: { access: { valid_until: '2027-01-01T00:00:00Z' }, accounts: [{ uid: 'acc-1' }], session_id: 'session-1' },
    });

    const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });
    const result = await client.exchangeSession('code-abc');

    expect(mocks.post).toHaveBeenCalledWith('/sessions', { code: 'code-abc' }, { headers: { Authorization: 'Bearer signed.jwt.token' } });
    expect(result).toEqual({ access: { validUntil: '2027-01-01T00:00:00Z' }, accounts: [{ uid: 'acc-1' }], sessionId: 'session-1' });
  });

  it('getAccountTransactions maps camelCase params to Enable Banking snake_case query params', async () => {
    const { createEnableBankingClient } = await importClient();
    mocks.get.mockResolvedValueOnce({ data: { continuation_key: null, transactions: [] } });

    const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });
    await client.getAccountTransactions('account-1', { continuationKey: 'ck-1', dateFrom: '2027-01-01', dateTo: '2027-01-31' });

    expect(mocks.get).toHaveBeenCalledWith('/accounts/account-1/transactions', {
      headers: { Authorization: 'Bearer signed.jwt.token' },
      params: { continuation_key: 'ck-1', date_from: '2027-01-01', date_to: '2027-01-31' },
    });
  });

  function axiosErrorWithStatus(status: number, headers: Record<string, string> = {}): AxiosError {
    const response = {
      config: {} as AxiosResponse['config'],
      data: { error: 'provider says no' },
      headers: new AxiosHeaders(headers),
      status,
      statusText: 'error',
    } as AxiosResponse;
    return new AxiosError('Request failed', String(status), undefined, undefined, response);
  }

  it('maps a 401 response to UnauthorizedError, not a raw AxiosError', async () => {
    const { createEnableBankingClient } = await importClient();
    mocks.get.mockRejectedValueOnce(axiosErrorWithStatus(401));

    const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });

    await expect(client.listInstitutions({})).rejects.toMatchObject({ name: 'UnauthorizedError', status: 401 });
  });

  it('maps a 429 response to TooManyRequestsError with retryAfter from the header', async () => {
    const { createEnableBankingClient } = await importClient();
    mocks.get.mockRejectedValueOnce(axiosErrorWithStatus(429, { 'retry-after': '30' }));

    const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });

    await expect(client.listInstitutions({})).rejects.toMatchObject({ name: 'TooManyRequestsError', retryAfter: 30, status: 429 });
  });

  it('reads an HTTP-date Retry-After as the seconds left until that date', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-06T10:00:00Z') });
    try {
      const { createEnableBankingClient } = await importClient();
      mocks.get.mockRejectedValueOnce(axiosErrorWithStatus(429, { 'retry-after': 'Fri, 06 Nov 2026 12:00:00 GMT' }));
      const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });
      await expect(client.listInstitutions({})).rejects.toMatchObject({ retryAfter: 7200, status: 429 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('getSession reads the session status from GET /sessions/{id}', async () => {
    const { createEnableBankingClient } = await importClient();
    mocks.get.mockResolvedValueOnce({ data: { access: { valid_until: '2027-01-01T00:00:00Z' }, accounts: ['a-1'], status: 'REVOKED' } });
    const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });
    await expect(client.getSession('sess/1')).resolves.toEqual({ status: 'REVOKED', validUntil: '2027-01-01T00:00:00Z' });
    expect(mocks.get).toHaveBeenCalledWith('/sessions/sess%2F1', { headers: { Authorization: 'Bearer signed.jwt.token' } });
  });

  describe('Enable Banking error bodies', () => {
    function failure(status: number, data: unknown) {
      const response = { config: { headers: new AxiosHeaders() }, data, headers: new AxiosHeaders(), status, statusText: 'error' } as AxiosResponse;
      return new AxiosError('Request failed', String(status), undefined, undefined, response);
    }

    it('keeps Enable Banking\'s own error code and message on the thrown error, so callers can branch on it', async () => {
      const { createEnableBankingClient } = await importClient();
      mocks.get.mockRejectedValueOnce(failure(422, { code: 422, detail: { echoed: 'request' }, error: 'WRONG_TRANSACTIONS_PERIOD', message: 'Wrong transactions period requested' }));
      const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });

      const error = await client.getAccountTransactions('acc-1', { dateFrom: '2025-01-01' }).catch((caught: unknown) => caught);

      expect(error).toMatchObject({ enableBankingError: { code: 'WRONG_TRANSACTIONS_PERIOD', message: 'Wrong transactions period requested', status: 422 }, status: 422 });
    });

    it('does not log a refused transaction period as an error, since the sync retries it', async () => {
      const { createEnableBankingClient } = await importClient();
      const { default: logger } = await import('@utils/logger');
      const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      mocks.get.mockRejectedValueOnce(failure(422, { code: 422, error: 'WRONG_TRANSACTIONS_PERIOD', message: 'Wrong transactions period requested' }));
      const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });

      await expect(client.getAccountTransactions('acc-1', { dateFrom: '2025-01-01' })).rejects.toMatchObject({ status: 422 });

      expect(errorLog).not.toHaveBeenCalled();
      errorLog.mockRestore();
    });

    it('logs the code and message without the personal data a message can quote', async () => {
      const { createEnableBankingClient } = await importClient();
      const { default: logger } = await import('@utils/logger');
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const personal = ['ES9121000418450200051332', 'owner@example.test', '12345678901', '1.234,56'];
      mocks.get.mockRejectedValueOnce(failure(400, {
        code: 400,
        error: 'WRONG_REQUEST_PARAMETERS',
        iban: personal[0],
        message: `Account ${personal[0]} of ${personal[1]} (number ${personal[2]}) refused: balance ${personal[3]} EUR`,
      }));
      const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });

      await expect(client.getAccountBalances('acc-1')).rejects.toMatchObject({ enableBankingError: { code: 'WRONG_REQUEST_PARAMETERS' }, status: 400 });

      const logged = warn.mock.calls.find(([, message]) => String(message).includes('Enable Banking API request failed'));
      expect(logged?.[0]).toMatchObject({ enableBankingError: { code: 'WRONG_REQUEST_PARAMETERS', status: 400 }, enableBankingOperation: 'getAccountBalances' });
      const serialized = JSON.stringify(logged?.[0]);
      expect(serialized).toContain('refused');
      for (const value of personal) expect(serialized).not.toContain(value);
      warn.mockRestore();
    });

    it('logs only the code of a failure the bank relays, and never the detail', async () => {
      const { createEnableBankingClient } = await importClient();
      const { default: logger } = await import('@utils/logger');
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      mocks.get.mockRejectedValueOnce(failure(400, { code: 400, detail: { request: 'echoed-request-body' }, error: 'ASPSP_ERROR', message: 'Bank says: customer Jane Doe blocked' }));
      const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });

      const error = await client.getAccountBalances('acc-1').catch((caught: unknown) => caught);

      expect((error as { enableBankingError?: unknown }).enableBankingError).toEqual({ code: 'ASPSP_ERROR', status: 400 });
      const logged = warn.mock.calls.find(([, message]) => String(message).includes('Enable Banking API request failed'));
      const serialized = JSON.stringify(logged?.[0]);
      expect(serialized).toContain('ASPSP_ERROR');
      expect(serialized).not.toContain('Jane Doe');
      expect(serialized).not.toContain('echoed-request-body');
      warn.mockRestore();
    });

    it('ignores an error field that is not an Enable Banking code', async () => {
      const { createEnableBankingClient } = await importClient();
      mocks.get.mockRejectedValueOnce(failure(400, { error: 'provider says no' }));
      const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });

      const error = await client.getAccountBalances('acc-1').catch((caught: unknown) => caught);

      expect((error as { enableBankingError?: { code?: string } }).enableBankingError?.code).toBeUndefined();
    });
  });

  it('maps a 500 response to BadGatewayError', async () => {
    const { createEnableBankingClient } = await importClient();
    mocks.get.mockRejectedValueOnce(axiosErrorWithStatus(500));

    const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });

    await expect(client.listInstitutions({})).rejects.toMatchObject({ name: 'BadGatewayError', status: 502 });
  });

  it('maps a network failure with no response to BadGatewayError', async () => {
    const { createEnableBankingClient } = await importClient();
    const networkError = new AxiosError('Network Error', 'ERR_NETWORK');
    mocks.get.mockRejectedValueOnce(networkError);

    const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });

    await expect(client.listInstitutions({})).rejects.toMatchObject({ name: 'BadGatewayError', status: 502 });
  });

  it('maps a non-axios error to InternalServerError instead of leaking it raw', async () => {
    const { createEnableBankingClient } = await importClient();
    mocks.get.mockRejectedValueOnce(new Error('totally unexpected'));

    const client = createEnableBankingClient({ applicationId: 'app-123', privateKeyPem: 'test-pem' });

    await expect(client.listInstitutions({})).rejects.toMatchObject({ name: 'InternalServerError', status: 500 });
  });
});
