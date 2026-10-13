import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDecryptedCredential = vi.hoisted(() => vi.fn());
const createEnableBankingClient = vi.hoisted(() => vi.fn());
const listInstitutions = vi.hoisted(() => vi.fn());

vi.mock('@service/enable-banking/enable-banking-client.service', () => ({ createEnableBankingClient }));
vi.mock('@service/enable-banking/enable-banking-credential.service', () => ({
  enableBankingCredentialService: { getDecryptedCredential },
}));

import { encodeEnableBankingInstitutionId } from '@utils/enable-banking-institution-id';
import { BadGatewayError, BadRequestError } from '@utils/errors';

import { mockRes } from '../../__tests__/__helpers__/mock-request';
import { getBankList } from '../banking';

const createReq = (country?: string) => ({ query: { country }, user: { appuserKey: 1 } });
const createRes = () => {
  const json = vi.fn();
  return { json, res: mockRes({ json }) };
};

describe('getBankList (Enable Banking)', () => {
  beforeEach(() => {
    getDecryptedCredential.mockReset();
    createEnableBankingClient.mockReset();
    listInstitutions.mockReset();
    createEnableBankingClient.mockReturnValue({ listInstitutions });
  });

  it('throws a typed 400 when the user has no Enable Banking credential configured', async () => {
    getDecryptedCredential.mockResolvedValueOnce(null);
    const res = createRes();

    const error = await getBankList(createReq('PT') as unknown as Parameters<typeof getBankList>[0], res.res).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as BadRequestError).status).toBe(400);
    expect(createEnableBankingClient).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('maps institutions to a stable synthesized id and the same name/logo/country field names', async () => {
    getDecryptedCredential.mockResolvedValueOnce({ applicationId: 'app-1', privateKeyPem: 'pem' });
    listInstitutions.mockResolvedValueOnce([
      { country: 'PT', logo: 'https://logo/a', maximum_consent_validity: 15_552_000, name: 'Bank A' },
      { country: 'PT', name: 'Bank B' },
    ]);
    const res = createRes();

    await getBankList(createReq('PT') as unknown as Parameters<typeof getBankList>[0], res.res);

    expect(createEnableBankingClient).toHaveBeenCalledWith({ applicationId: 'app-1', privateKeyPem: 'pem' });
    expect(listInstitutions).toHaveBeenCalledWith({ country: 'PT' });
    expect(res.json).toHaveBeenCalledWith([
      { country: 'PT', id: encodeEnableBankingInstitutionId({ country: 'PT', name: 'Bank A' }), logo: 'https://logo/a', name: 'Bank A' },
      { country: 'PT', id: encodeEnableBankingInstitutionId({ country: 'PT', name: 'Bank B' }), logo: '', name: 'Bank B' },
    ]);
  });

  it('produces different ids for institutions that share a name in different countries', async () => {
    getDecryptedCredential.mockResolvedValueOnce({ applicationId: 'app-1', privateKeyPem: 'pem' });
    listInstitutions.mockResolvedValueOnce([
      { country: 'PT', name: 'Revolut' },
      { country: 'ES', name: 'Revolut' },
    ]);
    const res = createRes();

    await getBankList(createReq() as unknown as Parameters<typeof getBankList>[0], res.res);

    const payload = res.json.mock.calls[0]![0] as { id: string }[];
    expect(payload[0]!.id).not.toBe(payload[1]!.id);
  });

  it('propagates a typed Enable Banking provider error unchanged, without re-wrapping', async () => {
    getDecryptedCredential.mockResolvedValueOnce({ applicationId: 'app-1', privateKeyPem: 'pem' });
    const providerError = new BadGatewayError('Enable Banking is temporarily unavailable');
    listInstitutions.mockRejectedValueOnce(providerError);
    const res = createRes();

    const error = await getBankList(createReq('PT') as unknown as Parameters<typeof getBankList>[0], res.res).catch((e: unknown) => e);

    expect(error).toBe(providerError);
    expect(res.json).not.toHaveBeenCalled();
  });
});
