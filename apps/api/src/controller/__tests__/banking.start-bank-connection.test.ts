import { beforeEach, describe, expect, it, vi } from 'vitest';

const createConnection = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const em = vi.hoisted(() => ({ getRepository: vi.fn(() => ({ createConnection })) }));
const getActiveCredentialEntity = vi.hoisted(() => vi.fn());
const decryptCredentialEntity = vi.hoisted(() => vi.fn());
const createEnableBankingClient = vi.hoisted(() => vi.fn());
const listInstitutions = vi.hoisted(() => vi.fn());
const startAuthorization = vi.hoisted(() => vi.fn());

vi.mock('@app/app', () => ({ DI: { em } }));
vi.mock('@service/enable-banking/enable-banking-client.service', () => ({ createEnableBankingClient }));
vi.mock('@service/enable-banking/enable-banking-credential.service', () => ({
  enableBankingCredentialService: { decryptCredentialEntity, getActiveCredentialEntity },
}));

import { ENABLE_BANKING_CALLBACK_URL } from '@utils/constants';
import { encodeEnableBankingInstitutionId } from '@utils/enable-banking-institution-id';
import { BadRequestError, InternalServerError, NotFoundError } from '@utils/errors';

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { startBankConnection } from '../banking';

const credentialEntity = { enableBankingCredentialKey: 7 };
const decryptedCredential = { applicationId: 'app-1', privateKeyPem: 'pem' };

const createReq = (bankId: string, tenant: null | { tenantKey: number } = { tenantKey: 113 }, query: Record<string, string> = {}) =>
  Object.assign(mockReq({ params: { bankId }, query }), { tenant: tenant ?? undefined, user: { appuserKey: 1 } });
const createRes = () => mockRes();

describe('startBankConnection (Enable Banking)', () => {
  beforeEach(() => {
    createConnection.mockReset().mockResolvedValue(undefined);
    em.getRepository.mockReset().mockReturnValue({ createConnection });
    getActiveCredentialEntity.mockReset().mockResolvedValue(credentialEntity);
    decryptCredentialEntity.mockReset().mockReturnValue(decryptedCredential);
    createEnableBankingClient.mockReset().mockReturnValue({ listInstitutions, startAuthorization });
    listInstitutions.mockReset();
    startAuthorization.mockReset().mockResolvedValue({ authorizationId: 'auth-1', psuIdHash: 'hash', url: 'https://bank.example/consent' });
  });

  it('fails closed when the request is missing a resolved tenant', async () => {
    const bankId = encodeEnableBankingInstitutionId({ country: 'PT', name: 'Bank A' });
    const res = createRes();

    const error = await startBankConnection(createReq(bankId, null), res).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InternalServerError);
    expect(getActiveCredentialEntity).not.toHaveBeenCalled();
  });

  it('rejects a malformed institution id', async () => {
    const res = createRes();

    const error = await startBankConnection(createReq('not-a-valid-id'), res).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestError);
    expect(getActiveCredentialEntity).not.toHaveBeenCalled();
  });

  it('throws a typed 400 when the user has no Enable Banking credential configured', async () => {
    getActiveCredentialEntity.mockResolvedValueOnce(null);
    const bankId = encodeEnableBankingInstitutionId({ country: 'PT', name: 'Bank A' });
    const res = createRes();

    const error = await startBankConnection(createReq(bankId), res).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestError);
    expect(createEnableBankingClient).not.toHaveBeenCalled();
  });

  it('404s when the institution is no longer present in a fresh listing', async () => {
    listInstitutions.mockResolvedValueOnce([{ country: 'PT', maximum_consent_validity: 1000, name: 'A Different Bank' }]);
    const bankId = encodeEnableBankingInstitutionId({ country: 'PT', name: 'Bank A' });
    const res = createRes();

    const error = await startBankConnection(createReq(bankId), res).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(startAuthorization).not.toHaveBeenCalled();
  });

  it('500s when the matched institution has no maximum_consent_validity', async () => {
    listInstitutions.mockResolvedValueOnce([{ country: 'PT', name: 'Bank A' }]);
    const bankId = encodeEnableBankingInstitutionId({ country: 'PT', name: 'Bank A' });
    const res = createRes();

    const error = await startBankConnection(createReq(bankId), res).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InternalServerError);
    expect(startAuthorization).not.toHaveBeenCalled();
  });

  it('resolves maximum_consent_validity per-institution — picks the matched bank, not the first in the list', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    listInstitutions.mockResolvedValueOnce([
      { country: 'PT', maximum_consent_validity: 7_776_000, name: 'Bank A' }, // 90 days
      { country: 'PT', maximum_consent_validity: 15_552_000, name: 'Bank B' }, // 180 days
    ]);
    const bankId = encodeEnableBankingInstitutionId({ country: 'PT', name: 'Bank B' });
    const res = createRes();

    await startBankConnection(createReq(bankId), res);

    const expectedValidUntil = new Date(Date.parse('2027-01-01T00:00:00.000Z') + 15_552_000 * 1000).toISOString();
    expect(startAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ aspsp: { country: 'PT', name: 'Bank B' }, validUntil: expectedValidUntil }),
    );
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({ appuserKey: 1 }),
      expect.objectContaining({ tenantKey: 113 }),
      credentialEntity,
      expect.any(String),
      'Bank B',
      'PT',
      15_552_000,
      null,
    );
    vi.useRealTimers();
  });

  it('persists a created-status connection with the redirect URL registered for this app, and returns the provider redirect url', async () => {
    listInstitutions.mockResolvedValueOnce([{ country: 'PT', maximum_consent_validity: 7_776_000, name: 'Bank A' }]);
    const bankId = encodeEnableBankingInstitutionId({ country: 'PT', name: 'Bank A' });
    const res = createRes();

    await startBankConnection(createReq(bankId), res);

    expect(startAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ psuType: 'personal', redirectUrl: ENABLE_BANKING_CALLBACK_URL }),
    );
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({ appuserKey: 1 }),
      expect.objectContaining({ tenantKey: 113 }),
      credentialEntity,
      expect.any(String),
      'Bank A',
      'PT',
      7_776_000,
      null,
    );
    expect(res.json).toHaveBeenCalledWith({ redirectUrl: 'https://bank.example/consent' });
  });

  it('generates a fresh, unique state per call', async () => {
    listInstitutions.mockResolvedValue([{ country: 'PT', maximum_consent_validity: 7_776_000, name: 'Bank A' }]);
    const bankId = encodeEnableBankingInstitutionId({ country: 'PT', name: 'Bank A' });

    await startBankConnection(createReq(bankId), createRes());
    await startBankConnection(createReq(bankId), createRes());

    const [firstState] = startAuthorization.mock.calls[0] as [{ state: string }];
    const [secondState] = startAuthorization.mock.calls[1] as [{ state: string }];
    expect(firstState.state).not.toBe(secondState.state);
  });

  describe('which client the callback returns to', () => {
    const bankId = encodeEnableBankingInstitutionId({ country: 'PT', name: 'Bank A' });
    const storedReturnTo = (): unknown => createConnection.mock.calls[0]?.[7];

    beforeEach(() => {
      listInstitutions.mockResolvedValue([{ country: 'PT', maximum_consent_validity: 7_776_000, name: 'Bank A' }]);
    });

    it('stores mobile for a connection the mobile app starts', async () => {
      await startBankConnection(createReq(bankId, undefined, { returnTo: 'mobile' }), createRes());
      expect(storedReturnTo()).toBe('mobile');
    });

    it('stores nothing (the web app) when no client is named, as older mobile builds do', async () => {
      await startBankConnection(createReq(bankId, undefined, { redirectPage: 'accounts' }), createRes());
      expect(storedReturnTo()).toBeNull();
    });

    it('treats an unknown client as the web app', async () => {
      await startBankConnection(createReq(bankId, undefined, { returnTo: 'https://evil.example' }), createRes());
      expect(storedReturnTo()).toBeNull();
    });
  });
});
