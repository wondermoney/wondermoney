import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addMerchant, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import accountRoutes from '@route/account';
import { clearMerchantLogoCache } from '@service/transaction/merchant-logo';

const TEMPLATE = 'https://logos.example.com/{domain}.png';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface MerchantBody { logoUrl: null | string; name: string; resolvedLogoUrl: null | string; transactionMerchantKey: number; website: null | string }

/*
 * A household sets a merchant's website and logo, and every list that shows the merchant shows
 * them. Only the household's own merchants can be edited, and with no logo template configured the
 * server builds no logo address and asks no one for an image.
 */
describe('editing a transaction merchant', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/account', accountRoutes);
  let fetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearMerchantLogoCache();
    vi.stubEnv('MERCHANT_LOGO_URL_TEMPLATE', '');
    fetch = vi.fn(() => Promise.resolve(new Response(PNG, { headers: { 'content-type': 'image/png' } })));
    vi.stubGlobal('fetch', fetch);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function householdWithMerchant() {
    const em = db.em();
    const household = await seedHousehold(em);
    const merchant = await addMerchant(em, household, 'Corner Shop');
    await addTransaction(em, household, { amount: -12, date: new Date(), merchant, status: 'BOOKED' });
    return { household, merchant };
  }

  const merchantsOf = async (user: Parameters<typeof http.as>[0]) => (await http.as(user).get('/v1/account/transaction-merchants')).body.transactionMerchants as MerchantBody[];
  const firstRowMerchant = async (user: Parameters<typeof http.as>[0]) => (await http.as(user).get('/v1/account/transaction')).body.transactions[0].transactionMerchantKey as MerchantBody;

  it('saves a website and a logo URL and shows them in the merchant and transaction lists', async () => {
    const { household, merchant } = await householdWithMerchant();
    const logoUrl = 'https://cdn.example.org/corner-shop.png';

    const response = await http.as(household.appuser).patch(`/v1/account/transaction-merchants/${merchant.transactionMerchantKey}`).send({ logoUrl, website: 'https://corner-shop.example.com' });

    expect(response.status).toBe(200);
    const expected = { logoUrl, name: 'Corner Shop', resolvedLogoUrl: logoUrl, transactionMerchantKey: merchant.transactionMerchantKey, website: 'https://corner-shop.example.com' };
    expect(response.body.transactionMerchant).toEqual(expected);
    expect(await merchantsOf(household.appuser)).toEqual([expected]);
    expect(await firstRowMerchant(household.appuser)).toEqual(expected);
  });

  it('clears a field sent as null and leaves the other alone', async () => {
    const { household, merchant } = await householdWithMerchant();
    const path = `/v1/account/transaction-merchants/${merchant.transactionMerchantKey}`;
    await http.as(household.appuser).patch(path).send({ logoUrl: 'https://cdn.example.org/a.png', website: 'https://example.com' });

    const response = await http.as(household.appuser).patch(path).send({ logoUrl: null });

    expect(response.body.transactionMerchant).toMatchObject({ logoUrl: null, resolvedLogoUrl: null, website: 'https://example.com' });
  });

  it.each(['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://example.com/logo.png'])('refuses %s and keeps what was stored', async (value) => {
    const { household, merchant } = await householdWithMerchant();

    const response = await http.as(household.appuser).patch(`/v1/account/transaction-merchants/${merchant.transactionMerchantKey}`).send({ logoUrl: value });

    expect(response.status).toBe(400);
    const stored = await db.em().fork().findOneOrFail(TransactionMerchant, { transactionMerchantKey: merchant.transactionMerchantKey });
    expect(stored.logoUrl ?? null).toBeNull();
  });

  it('is shared with the partner, who can edit it too', async () => {
    const { household, merchant } = await householdWithMerchant();
    const partner = await addPartner(db.em(), household);

    const response = await http.as(partner).patch(`/v1/account/transaction-merchants/${merchant.transactionMerchantKey}`).send({ website: 'https://example.com' });

    expect(response.status).toBe(200);
    expect((await merchantsOf(household.appuser))[0]?.website).toBe('https://example.com');
  });

  it('cannot edit another household\'s merchant', async () => {
    const { merchant } = await householdWithMerchant();
    const other = await seedHousehold(db.em());

    const response = await http.as(other.appuser).patch(`/v1/account/transaction-merchants/${merchant.transactionMerchantKey}`).send({ website: 'https://evil.example.com' });

    expect(response.status).toBe(404);
    const stored = await db.em().fork().findOneOrFail(TransactionMerchant, { transactionMerchantKey: merchant.transactionMerchantKey });
    expect(stored.website ?? null).toBeNull();
  });

  it('cannot edit a global merchant every household shares', async () => {
    const { household } = await householdWithMerchant();
    const em = db.em();
    const global = em.create(TransactionMerchant, { name: 'Global Mart', normalizedName: 'global mart' }, { partial: true });
    await em.flush();

    const response = await http.as(household.appuser).patch(`/v1/account/transaction-merchants/${global.transactionMerchantKey}`).send({ website: 'https://example.com' });

    expect(response.status).toBe(404);
  });

  it('cannot edit a merchant the member only knows from the partner\'s private account', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const privateAccount = await addAccount(em, household, { isPrivate: true });
    const clinic = await addMerchant(em, household, 'Private Clinic');
    await addTransaction(em, household, { account: privateAccount, amount: -80, date: new Date(), merchant: clinic, status: 'BOOKED' });

    const response = await http.as(partner).patch(`/v1/account/transaction-merchants/${clinic.transactionMerchantKey}`).send({ website: 'https://example.com' });

    expect(response.status).toBe(404);
  });

  describe('without MERCHANT_LOGO_URL_TEMPLATE', () => {
    it('builds no logo URL from the website and makes no outbound request', async () => {
      const { household, merchant } = await householdWithMerchant();
      await http.as(household.appuser).patch(`/v1/account/transaction-merchants/${merchant.transactionMerchantKey}`).send({ website: 'https://corner-shop.example.com' });

      expect((await merchantsOf(household.appuser))[0]?.resolvedLogoUrl).toBeNull();
      expect((await firstRowMerchant(household.appuser)).resolvedLogoUrl).toBeNull();
      const logo = await http.as(household.appuser).get(`/v1/account/transaction-merchants/${merchant.transactionMerchantKey}/logo`);

      expect(logo.status).toBe(404);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('with MERCHANT_LOGO_URL_TEMPLATE', () => {
    beforeEach(() => vi.stubEnv('MERCHANT_LOGO_URL_TEMPLATE', TEMPLATE));

    it('points clients at the API, which fetches the image for the website\'s domain', async () => {
      const { household, merchant } = await householdWithMerchant();
      await http.as(household.appuser).patch(`/v1/account/transaction-merchants/${merchant.transactionMerchantKey}`).send({ website: 'https://www.corner-shop.example.com/about' });

      const resolved = (await merchantsOf(household.appuser))[0]?.resolvedLogoUrl;
      expect(resolved).toMatch(new RegExp(`/v1/account/transaction-merchants/${merchant.transactionMerchantKey}/logo$`));
      expect(fetch).not.toHaveBeenCalled();

      const logo = await http.as(household.appuser).get(`/v1/account/transaction-merchants/${merchant.transactionMerchantKey}/logo`);

      expect(logo.status).toBe(200);
      expect(logo.headers['content-type']).toBe('image/png');
      expect(logo.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.from(logo.body as Buffer).equals(Buffer.from(PNG))).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('https://logos.example.com/corner-shop.example.com.png');
    });

    it('uses the household\'s own logo URL instead, without asking the provider', async () => {
      const { household, merchant } = await householdWithMerchant();
      const own = 'https://cdn.example.org/corner-shop.png';
      await http.as(household.appuser).patch(`/v1/account/transaction-merchants/${merchant.transactionMerchantKey}`).send({ logoUrl: own, website: 'https://corner-shop.example.com' });

      expect((await merchantsOf(household.appuser))[0]?.resolvedLogoUrl).toBe(own);
      const logo = await http.as(household.appuser).get(`/v1/account/transaction-merchants/${merchant.transactionMerchantKey}/logo`);

      expect(logo.status).toBe(404);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('serves no logo for another household\'s merchant', async () => {
      const { household, merchant } = await householdWithMerchant();
      await http.as(household.appuser).patch(`/v1/account/transaction-merchants/${merchant.transactionMerchantKey}`).send({ website: 'https://corner-shop.example.com' });
      const other = await seedHousehold(db.em());

      const logo = await http.as(other.appuser).get(`/v1/account/transaction-merchants/${merchant.transactionMerchantKey}/logo`);

      expect(logo.status).toBe(404);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
