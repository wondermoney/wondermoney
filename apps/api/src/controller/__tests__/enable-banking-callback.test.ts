import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const changeToError = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const changeToLinked = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const findByState = vi.hoisted(() => vi.fn());
const em = vi.hoisted(() => ({ getRepository: vi.fn(() => ({ changeToError, changeToLinked, findByState })) }));
const decryptCredentialEntity = vi.hoisted(() => vi.fn());
const createEnableBankingClient = vi.hoisted(() => vi.fn());
const exchangeSession = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }));
const createInitialEnableBankingAccounts = vi.hoisted(() => vi.fn());
const enqueue = vi.hoisted(() => vi.fn());
// Real error class needed so `postLinkError instanceof AccountInitialSyncQueueError` narrows correctly.
const { AccountInitialSyncQueueError } = vi.hoisted(() => {
  class QueueError extends Error {
    constructor(message: string, public readonly queueAccepted: boolean, public readonly incidentId?: string) {
      super(message);
      this.name = 'AccountInitialSyncQueueError';
    }
  }
  return { AccountInitialSyncQueueError: QueueError };
});

vi.mock('@app/app', () => ({ DI: { em } }));
vi.mock('@service/enable-banking/enable-banking-client.service', () => ({ createEnableBankingClient }));
vi.mock('@service/enable-banking/enable-banking-credential.service', () => ({
  enableBankingCredentialService: { decryptCredentialEntity },
}));
vi.mock('@service/enable-banking/enable-banking-initial-accounts.service', () => ({ createInitialEnableBankingAccounts }));
vi.mock('@service/account/account-initial-sync-enqueue.service', () => ({ AccountInitialSyncQueueError, default: { enqueue } }));
vi.mock('@utils/logger', () => ({ default: logger }));

import { ENABLE_BANKING_CALLBACK_REDIRECT_URL } from '@utils/constants';

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { enableBankingCallback } from '../enable-banking-callback';

const createReq = (query: Record<string, string | undefined>) => mockReq({ query });
const createRes = () => Object.assign(mockRes(), { redirect: vi.fn() });
const credentialEntity = { enableBankingCredentialKey: 7 };

describe('enableBankingCallback', () => {
  beforeEach(() => {
    changeToError.mockReset().mockResolvedValue(undefined);
    changeToLinked.mockReset().mockResolvedValue(undefined);
    findByState.mockReset();
    em.getRepository.mockReset().mockReturnValue({ changeToError, changeToLinked, findByState });
    decryptCredentialEntity.mockReset().mockReturnValue({ applicationId: 'app-1', privateKeyPem: 'pem' });
    createEnableBankingClient.mockReset().mockReturnValue({ exchangeSession });
    exchangeSession.mockReset();
    createInitialEnableBankingAccounts.mockReset().mockResolvedValue({ accounts: [{ accountId: 'acc-1' }], accountsCreated: 1, accountsSkipped: 0, skippedReasons: [] });
    enqueue.mockReset().mockResolvedValue({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    logger.warn.mockReset();
  });

  it('redirects to the safe error destination without crashing when state matches no connection (unknown/expired/consumed)', async () => {
    findByState.mockResolvedValueOnce(null);
    const res = createRes();

    await enableBankingCallback(createReq({ code: 'code-123', state: 'unknown-state' }), res);

    expect(res.redirect).toHaveBeenCalledWith(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
    expect(changeToError).not.toHaveBeenCalled();
    expect(changeToLinked).not.toHaveBeenCalled();
    expect(exchangeSession).not.toHaveBeenCalled();
  });

  it('redirects to the safe error destination when state is missing entirely', async () => {
    const res = createRes();

    await enableBankingCallback(createReq({ code: 'code-123' }), res);

    expect(res.redirect).toHaveBeenCalledWith(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
    expect(findByState).not.toHaveBeenCalled();
  });

  it('marks the connection as error and redirects to the error destination when Enable Banking reports an error', async () => {
    const connection = { enableBankingConnectionKey: 42, enableBankingCredentialKey: credentialEntity, maxConsentValiditySeconds: 7_776_000 };
    findByState.mockResolvedValueOnce(connection);
    const res = createRes();

    await enableBankingCallback(createReq({ error: 'access_denied', state: 'state-1' }), res);

    expect(changeToError).toHaveBeenCalledWith(connection);
    expect(res.redirect).toHaveBeenCalledWith(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
    expect(exchangeSession).not.toHaveBeenCalled();
  });

  it('exchanges the session, marks the connection linked with the real returned accessValidUntil, and redirects to success', async () => {
    const connection = { enableBankingConnectionKey: 42, enableBankingCredentialKey: credentialEntity, maxConsentValiditySeconds: 7_776_000 };
    findByState.mockResolvedValueOnce(connection);
    exchangeSession.mockResolvedValueOnce({
      access: { validUntil: '2027-06-01T00:00:00.000Z' },
      accounts: [{ id: 'acc-1' }],
      sessionId: 'session-abc',
    });
    const res = createRes();

    await enableBankingCallback(createReq({ code: 'code-123', state: 'state-1' }), res);

    expect(decryptCredentialEntity).toHaveBeenCalledWith(credentialEntity);
    expect(exchangeSession).toHaveBeenCalledWith('code-123');
    expect(changeToLinked).toHaveBeenCalledWith(connection, 'session-abc', new Date('2027-06-01T00:00:00.000Z'), 7_776_000);
    expect(res.redirect).toHaveBeenCalledWith(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'success' }));
  });

  // Phase 1d: after a successful link, the callback persists Account rows from the session's
  // accounts[] and enqueues the initial sync — this is the trigger that makes the whole Phase 1d
  // sync-adapter/wiring reachable end-to-end.
  describe('Phase 1d: initial-sync trigger after linking', () => {
    const connection = { enableBankingConnectionKey: 42, enableBankingCredentialKey: credentialEntity, maxConsentValiditySeconds: 7_776_000 };

    it('persists accounts from session.accounts and enqueues the initial sync job', async () => {
      const requestEnqueue = { send: vi.fn(), sendAfter: vi.fn() };
      findByState.mockResolvedValueOnce(connection);
      exchangeSession.mockResolvedValueOnce({
        access: { validUntil: '2027-06-01T00:00:00.000Z' },
        accounts: [{ currency: 'EUR', uid: 'acc-1' }],
        sessionId: 'session-abc',
      });
      const res = createRes();

      await enableBankingCallback(Object.assign(createReq({ code: 'code-123', state: 'state-1' }), { enqueue: requestEnqueue }), res);

      expect(createInitialEnableBankingAccounts).toHaveBeenCalledWith(em, connection, [{ currency: 'EUR', uid: 'acc-1' }]);
      expect(enqueue).toHaveBeenCalledWith(connection, { enqueue: requestEnqueue });
      expect(res.redirect).toHaveBeenCalledWith(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'success' }));
    });

    it('skips enqueueing when zero accounts were created, but still redirects to success', async () => {
      findByState.mockResolvedValueOnce(connection);
      exchangeSession.mockResolvedValueOnce({ access: { validUntil: '2027-06-01T00:00:00.000Z' }, accounts: [], sessionId: 'session-abc' });
      createInitialEnableBankingAccounts.mockResolvedValueOnce({ accounts: [], accountsCreated: 0, accountsSkipped: 0, skippedReasons: [] });
      const res = createRes();

      await enableBankingCallback(createReq({ code: 'code-123', state: 'state-1' }), res);

      expect(enqueue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ enableBankingConnectionKey: 42 }), expect.stringMatching(/zero accounts/));
      expect(res.redirect).toHaveBeenCalledWith(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'success' }));
    });

    it('still redirects to success and logs a warning when account creation throws — the bank link itself already succeeded', async () => {
      findByState.mockResolvedValueOnce(connection);
      exchangeSession.mockResolvedValueOnce({ access: { validUntil: '2027-06-01T00:00:00.000Z' }, accounts: [{ uid: 'acc-1' }], sessionId: 'session-abc' });
      createInitialEnableBankingAccounts.mockRejectedValueOnce(new Error('db unavailable'));
      const res = createRes();

      await enableBankingCallback(createReq({ code: 'code-123', state: 'state-1' }), res);

      expect(enqueue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ enableBankingConnectionKey: 42, errorMessage: 'db unavailable' }), expect.stringMatching(/account creation or initial-sync enqueue failed/));
      expect(res.redirect).toHaveBeenCalledWith(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'success' }));
      expect(changeToError).not.toHaveBeenCalled();
    });

    it('still redirects to success and logs the queueAccepted flag when enqueue throws AccountInitialSyncQueueError', async () => {
      findByState.mockResolvedValueOnce(connection);
      exchangeSession.mockResolvedValueOnce({ access: { validUntil: '2027-06-01T00:00:00.000Z' }, accounts: [{ uid: 'acc-1' }], sessionId: 'session-abc' });
      enqueue.mockRejectedValueOnce(new AccountInitialSyncQueueError('queue down', false, 'incident-1'));
      const res = createRes();

      await enableBankingCallback(createReq({ code: 'code-123', state: 'state-1' }), res);

      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ queueAccepted: false }), expect.stringMatching(/account creation or initial-sync enqueue failed/));
      expect(res.redirect).toHaveBeenCalledWith(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'success' }));
    });
  });

  it('marks the connection as error and redirects to error when session exchange itself fails', async () => {
    const connection = { enableBankingConnectionKey: 42, enableBankingCredentialKey: credentialEntity, maxConsentValiditySeconds: 7_776_000 };
    findByState.mockResolvedValueOnce(connection);
    exchangeSession.mockRejectedValueOnce(new Error('Enable Banking credential is invalid or expired'));
    const res = createRes();

    await enableBankingCallback(createReq({ code: 'code-123', state: 'state-1' }), res);

    expect(changeToError).toHaveBeenCalledWith(connection);
    expect(changeToLinked).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
  });

  it('marks the connection as error and redirects to error when neither code nor error is present', async () => {
    const connection = { enableBankingConnectionKey: 42, enableBankingCredentialKey: credentialEntity, maxConsentValiditySeconds: 7_776_000 };
    findByState.mockResolvedValueOnce(connection);
    const res = createRes();

    await enableBankingCallback(createReq({ state: 'state-1' }), res);

    expect(changeToError).toHaveBeenCalledWith(connection);
    expect(res.redirect).toHaveBeenCalledWith(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
  });

  // Security-critical: the redirect destination must be a hardcoded/env-configured
  // WonderMoney URL, never derived from any part of the incoming request — otherwise
  // this callback is an open redirect. Every query value below is attacker-controlled
  // and must have zero influence on the final redirect target beyond success/error.
  describe('redirect destination is never influenced by request input (open-redirect safety)', () => {
    it('ignores an attempted open-redirect payload in state (falls through to the safe unknown-state error redirect)', async () => {
      findByState.mockResolvedValueOnce(null);
      const res = createRes();

      await enableBankingCallback(
        createReq({ code: 'code-123', state: 'https://evil.example/phish' }),
        res,
      );

      expect(findByState).toHaveBeenCalledWith('https://evil.example/phish');
      expect(res.redirect).toHaveBeenCalledExactlyOnceWith(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
      const redirectTarget = String(res.redirect.mock.calls[0]![0]);
      expect(redirectTarget.startsWith('https://evil.example')).toBe(false);
    });

    it('ignores an attempted open-redirect payload in the error param on a matched connection', async () => {
      const connection = { enableBankingConnectionKey: 42, enableBankingCredentialKey: credentialEntity, maxConsentValiditySeconds: 7_776_000 };
      findByState.mockResolvedValueOnce(connection);
      const res = createRes();

      await enableBankingCallback(
        createReq({ error: 'https://evil.example/phish', state: 'state-1' }),
        res,
      );

      const redirectTarget = String(res.redirect.mock.calls[0]![0]);
      expect(redirectTarget).toBe(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
      expect(redirectTarget.startsWith('https://evil.example')).toBe(false);
    });

    it('ignores an attempted open-redirect payload in code on the success path — target is still the fixed success URL', async () => {
      const connection = { enableBankingConnectionKey: 42, enableBankingCredentialKey: credentialEntity, maxConsentValiditySeconds: 7_776_000 };
      findByState.mockResolvedValueOnce(connection);
      exchangeSession.mockResolvedValueOnce({
        access: { validUntil: '2027-06-01T00:00:00.000Z' },
        accounts: [],
        sessionId: 'session-abc',
      });
      const res = createRes();

      await enableBankingCallback(
        createReq({ code: 'https://evil.example/phish', state: 'state-1' }),
        res,
      );

      expect(exchangeSession).toHaveBeenCalledWith('https://evil.example/phish');
      const redirectTarget = String(res.redirect.mock.calls[0]![0]);
      expect(redirectTarget).toBe(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'success' }));
      expect(redirectTarget.startsWith('https://evil.example')).toBe(false);
    });

    it('the redirect target is always built from the fixed FRONTEND_URL-derived constant, regardless of any query input', () => {
      const successUrl = ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'success' });
      const errorUrl = ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' });

      expect(successUrl).toMatch(/^https?:\/\//);
      expect(errorUrl).toMatch(/^https?:\/\//);
      expect(new URL(successUrl).pathname).toBe('/settings');
      expect(new URL(errorUrl).pathname).toBe('/settings');
    });
  });

  // Phase 0's kill-switch must gate every code path this Phase 1c task adds, including
  // this brand-new unauthenticated route — not just the two existing controllers.
  describe('BANK_SYNC_PROVIDER_DISABLED gate', () => {
    afterEach(() => {
      vi.doUnmock('@config/env');
      vi.resetModules();
    });

    it('redirects to the safe error destination and never touches the DB when the flag is set', async () => {
      vi.resetModules();
      vi.doMock('@config/env', async (importOriginal) => ({ ...(await importOriginal<object>()), BANK_SYNC_PROVIDER_DISABLED: true }));
      const { enableBankingCallback: gatedCallback } = await import('../enable-banking-callback');
      const res = createRes();

      await gatedCallback(createReq({ code: 'code-123', state: 'state-1' }), res);

      expect(res.redirect).toHaveBeenCalledWith(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
      expect(findByState).not.toHaveBeenCalled();
      expect(exchangeSession).not.toHaveBeenCalled();
    });
  });
});
