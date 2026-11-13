import type { Job } from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addPartner, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { CryptoWalletSyncPayload } from '@app/jobs/crypto-wallet-sync.queue';
import { handleCryptoWalletSyncJob } from '@app/jobs/crypto-wallet-sync.worker';
import type { Appuser } from '@entity/Appuser';
import { ExchangeRate } from '@entity/ExchangeRate';
import manualAssetRoutes from '@route/manual-asset';
import { syncCryptoWallet } from '@service/crypto-wallet/crypto-wallet-sync.service';
import { chainReadersFromEnv } from '@service/crypto-wallet/explorers';
import type { TokenPrices } from '@service/crypto-wallet/token-prices';
import type { Enqueue } from '@service/queue/enqueue';
import logger from '@utils/logger';

import { blockscoutAddress, blockscoutToken, BTC, esploraAddress, ETH, fakeExplorerFetch, SECRETS } from './__fixtures__/wallet-fixtures';

/*
 * A crypto wallet is a manual asset valued from public addresses. These tests drive the real
 * routes and the real sync against recorded explorer answers; `fetch` is stubbed per test and
 * nothing leaves the process.
 */
const BTC_EXPLORER = 'https://mempool.example.org/api';
const ETH_EXPLORER = 'https://blockscout.example.org';
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const PRICES: Readonly<Record<string, number>> = { BTC: 60_000, ETH: 3000, USDC: 1 };

const prices = (table: Readonly<Record<string, number>> = PRICES): TokenPrices => ({ usd: (symbol) => Promise.resolve(table[symbol] ?? null) });

interface WalletBody {
  addresses: { address: string; chain: string; cryptoWalletAddressKey: number; errorCode: null | string; kind: string; lastSyncedAt: null | string; status: string; tokens: { contractAddress: null | string; cryptoWalletTokenKey: number; native: boolean; priceMissing: boolean; quantity: string; symbol: string; tracked: boolean }[] }[];
  lastSyncedAt: null | string;
  unpricedSymbols: string[];
}

describe('crypto wallets', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const sent: { payload: unknown; queue: string }[] = [];
  const enqueue: Enqueue = {
    send: (queue, payload) => {
      sent.push({ payload, queue });
      return Promise.resolve('job-id');
    },
    sendAfter: () => Promise.resolve('job-id'),
  };
  const http = tenantHttp('/v1/manual-assets', manualAssetRoutes, { enqueue });

  beforeEach(() => {
    sent.length = 0;
    vi.stubEnv('CRYPTO_BTC_EXPLORER_URL', BTC_EXPLORER);
    vi.stubEnv('CRYPTO_ETH_EXPLORER_URL', ETH_EXPLORER);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function household(): Promise<Household> {
    const em = db.em();
    await currencyFor(em, 'USD');
    return seedHousehold(em);
  }

  async function createWallet(user: Appuser, addresses: { address: string; chain: string; label?: string }[], extra: Record<string, unknown> = {}) {
    const response = await http.as(user).post('/v1/manual-assets/crypto-wallets').send({ addresses, name: 'Cold storage', ...extra });
    expect(response.status).toBe(201);
    return response.body as { asset: { currency: string; kind: string; manualAssetKey: number; value: null | number }; wallet: WalletBody };
  }

  async function detail(user: Appuser, manualAssetKey: number) {
    const response = await http.as(user).get(`/v1/manual-assets/${manualAssetKey}`);
    expect(response.status).toBe(200);
    return response.body as { asset: { value: null | number; valueInUserCurrency: null | number }; valuations: { date: string; value: number }[]; wallet: WalletBody };
  }

  /** Run the sync of one wallet as the worker does, against these explorer answers. */
  async function sync(manualAssetKey: number, routes: Parameters<typeof fakeExplorerFetch>[0], options: { prices?: TokenPrices; sleep?: (ms: number) => Promise<void> } = {}) {
    const explorer = fakeExplorerFetch(routes);
    const readers = chainReadersFromEnv({ fetch: explorer.fetch, minIntervalMs: 0, sleep: options.sleep ?? (() => Promise.resolve()) });
    const result = await syncCryptoWallet(db.em().fork(), manualAssetKey, { now: () => NOW, prices: options.prices ?? prices(), readers });
    return { calls: explorer.calls, result };
  }

  const btcUrl = (address: string) => `${BTC_EXPLORER}/address/${address}`;
  const ethUrl = (address: string) => `${ETH_EXPLORER}/api/v2/addresses/${address}`;

  describe('Bitcoin', () => {
    it('shows an address\'s balance and value after one sync', async () => {
      const owner = await household();
      const created = await createWallet(owner.appuser, [{ address: BTC.segwit, chain: 'bitcoin' }]);
      expect(created.asset).toMatchObject({ currency: 'USD', kind: 'crypto_wallet', value: null });
      expect(created.wallet.addresses).toEqual([expect.objectContaining({ address: BTC.segwit, kind: 'address', status: 'pending', tokens: [] })]);
      // Adding the wallet queued its first sync.
      expect(sent).toEqual([{ payload: { manualAssetKey: created.asset.manualAssetKey }, queue: 'crypto-wallet.sync' }]);

      const { result } = await sync(created.asset.manualAssetKey, { [btcUrl(BTC.segwit)]: { body: esploraAddress(BTC.segwit, { funded: 150_000_000, spent: 25_000_000 }) } });

      expect(result).toMatchObject({ addresses: { failed: 0, synced: 1 }, value: 75_000 });
      const shown = await detail(owner.appuser, created.asset.manualAssetKey);
      expect(shown.wallet.addresses[0]).toMatchObject({ errorCode: null, lastSyncedAt: NOW.toISOString(), status: 'ok', tokens: [{ native: true, priceMissing: false, quantity: '1.25', symbol: 'BTC', tracked: true }] });
      expect(shown.valuations).toEqual([expect.objectContaining({ date: TODAY, value: 75_000 })]);
    });

    it('converts the wallet into the viewer\'s currency at the household\'s rates', async () => {
      const owner = await household();
      const em = db.em();
      em.create(ExchangeRate, { date: new Date(Date.now() - 86_400_000), fromCurrency: await currencyFor(em, 'USD'), rate: 0.9, toCurrency: owner.currency }, { partial: true });
      await em.flush();
      const { asset } = await createWallet(owner.appuser, [{ address: BTC.segwit, chain: 'bitcoin' }]);
      // Valued today, so it is today's value whatever day the suite runs.
      const explorer = fakeExplorerFetch({ [btcUrl(BTC.segwit)]: { body: esploraAddress(BTC.segwit, { funded: 100_000_000 }) } });
      await syncCryptoWallet(db.em().fork(), asset.manualAssetKey, { prices: prices(), readers: chainReadersFromEnv({ fetch: explorer.fetch, minIntervalMs: 0 }) });

      expect((await detail(owner.appuser, asset.manualAssetKey)).asset).toMatchObject({ value: 60_000, valueInUserCurrency: 54_000 });
    });

    it('sums every used address of an xpub, receive and change, and stops after 20 unused', async () => {
      const owner = await household();
      const { asset } = await createWallet(owner.appuser, [{ address: BTC.zpub, chain: 'bitcoin' }]);

      const { calls, result } = await sync(asset.manualAssetKey, {
        [btcUrl(BTC.zpubChange0)]: { body: esploraAddress(BTC.zpubChange0, { funded: 10_000_000 }) },
        [btcUrl(BTC.zpubReceive0)]: { body: esploraAddress(BTC.zpubReceive0, { funded: 50_000_000, spent: 10_000_000 }) },
        // Every other derived address is unknown to the explorer (404): unused.
      });

      expect(result?.value).toBe(30_000);
      expect((await detail(owner.appuser, asset.manualAssetKey)).wallet.addresses[0]).toMatchObject({ kind: 'xpub', status: 'ok', tokens: [{ quantity: '0.5', symbol: 'BTC' }] });
      // One used address then 20 unused on each chain.
      expect(calls).toHaveLength(42);
      expect(calls[0]).toBe(btcUrl(BTC.zpubReceive0));
      expect(calls[21]).toBe(btcUrl(BTC.zpubChange0));
    });

    it('derives the addresses of an xpub and a ypub as their own address types', async () => {
      const owner = await household();
      const { asset } = await createWallet(owner.appuser, [{ address: BTC.xpub, chain: 'bitcoin' }, { address: BTC.ypub, chain: 'bitcoin' }]);

      const { result } = await sync(asset.manualAssetKey, {
        [btcUrl(BTC.xpubReceive0)]: { body: esploraAddress(BTC.xpubReceive0, { funded: 1_000_000 }) },
        [btcUrl(BTC.ypubReceive0)]: { body: esploraAddress(BTC.ypubReceive0, { funded: 2_000_000 }) },
      });

      expect(result?.value).toBe(1800);
    });
  });

  describe('Ethereum', () => {
    const ethRoutes = (usdc = '250000000') => ({
      [`${ethUrl(ETH.checksummed)}/token-balances`]: {
        body: [
          blockscoutToken(ETH.usdc, { decimals: '6', name: 'USD Coin', symbol: 'USDC', value: usdc }),
          blockscoutToken(ETH.airdrop, { decimals: '18', name: 'Claim your reward at example.org', symbol: 'FREE', value: '9000000000000000000000' }),
          blockscoutToken('0x00000000000000000000000000000000000000f7', { decimals: '0', name: 'A picture', symbol: 'PIC', type: 'ERC-721', value: '1' }),
        ],
      },
      [ethUrl(ETH.checksummed)]: { body: blockscoutAddress(ETH.checksummed, '1500000000000000000') },
    });

    it('lists the detected tokens unticked and counts only ETH until one is ticked', async () => {
      const owner = await household();
      const { asset } = await createWallet(owner.appuser, [{ address: ETH.checksummed.toLowerCase(), chain: 'ethereum' }]);

      const first = await sync(asset.manualAssetKey, ethRoutes());
      expect(first.result?.value).toBe(4500);
      const { wallet } = await detail(owner.appuser, asset.manualAssetKey);
      const [address] = wallet.addresses;
      expect(address?.address).toBe(ETH.checksummed);
      expect(address?.tokens.map(({ contractAddress, native, quantity, symbol, tracked }) => ({ contractAddress, native, quantity, symbol, tracked }))).toEqual([
        { contractAddress: null, native: true, quantity: '1.5', symbol: 'ETH', tracked: true },
        { contractAddress: ETH.airdrop, native: false, quantity: '9000', symbol: 'FREE', tracked: false },
        { contractAddress: ETH.usdc, native: false, quantity: '250', symbol: 'USDC', tracked: false },
      ]);

      const usdc = address?.tokens.find((token) => token.symbol === 'USDC');
      sent.length = 0;
      const ticked = await http.as(owner.appuser).patch(`/v1/manual-assets/${asset.manualAssetKey}/tokens/${usdc?.cryptoWalletTokenKey}`).send({ tracked: true });
      expect(ticked.status).toBe(200);
      expect(sent).toHaveLength(1);

      const second = await sync(asset.manualAssetKey, ethRoutes());
      expect(second.result?.value).toBe(4750);
      expect((await detail(owner.appuser, asset.manualAssetKey)).valuations).toEqual([expect.objectContaining({ date: TODAY, value: 4750 })]);
    });

    it('does not write the day\'s value while a ticked token has no price, and says which', async () => {
      const owner = await household();
      const { asset } = await createWallet(owner.appuser, [{ address: ETH.checksummed, chain: 'ethereum' }]);
      await sync(asset.manualAssetKey, ethRoutes());
      const free = (await detail(owner.appuser, asset.manualAssetKey)).wallet.addresses[0]?.tokens.find((token) => token.symbol === 'FREE');
      await http.as(owner.appuser).patch(`/v1/manual-assets/${asset.manualAssetKey}/tokens/${free?.cryptoWalletTokenKey}`).send({ tracked: true });

      const { result } = await sync(asset.manualAssetKey, ethRoutes());

      expect(result).toMatchObject({ unpricedSymbols: ['FREE'], value: null });
      const shown = await detail(owner.appuser, asset.manualAssetKey);
      expect(shown.wallet.unpricedSymbols).toEqual(['FREE']);
      expect(shown.wallet.addresses[0]?.tokens.find((token) => token.symbol === 'FREE')).toMatchObject({ priceMissing: true, tracked: true });
      // The earlier value stands rather than one that silently leaves a holding out.
      expect(shown.valuations).toEqual([expect.objectContaining({ value: 4500 })]);

      await http.as(owner.appuser).patch(`/v1/manual-assets/${asset.manualAssetKey}/tokens/${free?.cryptoWalletTokenKey}`).send({ tracked: false });
      expect((await sync(asset.manualAssetKey, ethRoutes())).result).toMatchObject({ unpricedSymbols: [], value: 4500 });
    });

    it('keeps a token\'s tick when the explorer stops listing it, at a zero balance', async () => {
      const owner = await household();
      const { asset } = await createWallet(owner.appuser, [{ address: ETH.checksummed, chain: 'ethereum' }]);
      await sync(asset.manualAssetKey, ethRoutes());
      const usdc = (await detail(owner.appuser, asset.manualAssetKey)).wallet.addresses[0]?.tokens.find((token) => token.symbol === 'USDC');
      await http.as(owner.appuser).patch(`/v1/manual-assets/${asset.manualAssetKey}/tokens/${usdc?.cryptoWalletTokenKey}`).send({ tracked: true });

      await sync(asset.manualAssetKey, { [`${ethUrl(ETH.checksummed)}/token-balances`]: { body: [] }, [ethUrl(ETH.checksummed)]: { body: blockscoutAddress(ETH.checksummed, '0') } });

      expect((await detail(owner.appuser, asset.manualAssetKey)).wallet.addresses[0]?.tokens.find((token) => token.symbol === 'USDC')).toMatchObject({ quantity: '0', tracked: true });
    });
  });

  describe('failures', () => {
    it('syncs the other addresses when one fails, and keeps the failed one\'s last balance', async () => {
      const owner = await household();
      const { asset } = await createWallet(owner.appuser, [{ address: BTC.segwit, chain: 'bitcoin' }, { address: BTC.legacy, chain: 'bitcoin' }, { address: ETH.checksummed, chain: 'ethereum' }]);
      await sync(asset.manualAssetKey, {
        [btcUrl(BTC.legacy)]: { body: esploraAddress(BTC.legacy, { funded: 10_000_000 }) },
        [btcUrl(BTC.segwit)]: { body: esploraAddress(BTC.segwit, { funded: 100_000_000 }) },
        [ethUrl(ETH.checksummed)]: { body: blockscoutAddress(ETH.checksummed, '1000000000000000000') },
      });

      const { result } = await sync(asset.manualAssetKey, {
        [btcUrl(BTC.legacy)]: { body: esploraAddress(BTC.legacy, { funded: 20_000_000 }) },
        [btcUrl(BTC.segwit)]: { status: 502 },
        [ethUrl(ETH.checksummed)]: new TypeError('fetch failed'),
      });

      expect(result).toMatchObject({ addresses: { failed: 2, synced: 1 } });
      const { wallet } = await detail(owner.appuser, asset.manualAssetKey);
      expect(wallet.addresses.map(({ errorCode, status, tokens }) => ({ errorCode, quantity: tokens[0]?.quantity, status }))).toEqual([
        { errorCode: 'unavailable', quantity: '1', status: 'failed' },
        { errorCode: null, quantity: '0.2', status: 'ok' },
        { errorCode: 'unavailable', quantity: '1', status: 'failed' },
      ]);
      // The failed addresses count at their last balance: 1.2 BTC and 1 ETH.
      expect(result?.value).toBe(75_000);
    });

    it('retries a busy explorer, honouring Retry-After, and gives up on a long wait', async () => {
      const owner = await household();
      const { asset } = await createWallet(owner.appuser, [{ address: BTC.segwit, chain: 'bitcoin' }, { address: BTC.legacy, chain: 'bitcoin' }]);
      const waits: number[] = [];
      const sleep = (ms: number) => {
        waits.push(ms);
        return Promise.resolve();
      };

      const { calls, result } = await sync(asset.manualAssetKey, {
        [btcUrl(BTC.legacy)]: [{ headers: { 'retry-after': '3600' }, status: 429 }],
        [btcUrl(BTC.segwit)]: [{ status: 503 }, { headers: { 'retry-after': '2' }, status: 429 }, { body: esploraAddress(BTC.segwit, { funded: 1000 }) }],
      }, { sleep });

      expect(result).toMatchObject({ addresses: { failed: 1, synced: 1 } });
      expect(waits).toEqual([1000, 2000]);
      expect(calls.filter((url) => url === btcUrl(BTC.legacy))).toHaveLength(1);
      expect((await detail(owner.appuser, asset.manualAssetKey)).wallet.addresses.map((address) => address.errorCode)).toEqual([null, 'rate_limited']);
    });

    it('records a timeout after its retries', async () => {
      const owner = await household();
      const { asset } = await createWallet(owner.appuser, [{ address: BTC.segwit, chain: 'bitcoin' }]);
      const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');

      const { calls } = await sync(asset.manualAssetKey, { [btcUrl(BTC.segwit)]: timeout });

      expect(calls).toHaveLength(3);
      expect((await detail(owner.appuser, asset.manualAssetKey)).wallet.addresses[0]).toMatchObject({ errorCode: 'timeout', status: 'failed' });
    });

    it('fails a chain whose explorer was switched off without asking anyone', async () => {
      const owner = await household();
      const { asset } = await createWallet(owner.appuser, [{ address: BTC.segwit, chain: 'bitcoin' }]);
      vi.stubEnv('CRYPTO_BTC_EXPLORER_URL', '');

      const { calls } = await sync(asset.manualAssetKey, {});

      expect(calls).toEqual([]);
      expect((await detail(owner.appuser, asset.manualAssetKey)).wallet.addresses[0]).toMatchObject({ errorCode: 'disabled', status: 'failed' });
    });
  });

  describe('public addresses only', () => {
    it.each(Object.entries(SECRETS))('refuses %s without storing, logging or echoing it', async (_label, secret) => {
      const owner = await household();
      const logged: unknown[] = [];
      for (const level of ['debug', 'error', 'info', 'trace', 'warn', 'fatal'] as const) {
        vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
          logged.push(args);
        }));
      }

      const response = await http.as(owner.appuser).post('/v1/manual-assets/crypto-wallets').send({ addresses: [{ address: BTC.segwit, chain: 'bitcoin' }, { address: secret, chain: 'ethereum' }], name: 'Hot wallet' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'crypto_wallet_secret_rejected', details: { addressIndex: '1' } });
      const fingerprint = secret.trim().split(/\s+/u).slice(0, 3).join(' ').slice(0, 16);
      expect(JSON.stringify(response.body)).not.toContain(fingerprint);
      expect(JSON.stringify(logged)).not.toContain(fingerprint);
      const stored = await db.em().getConnection().execute<{ n: string }[]>(`select count(*)::text as n from manual_asset where tenant_key = ?`, [owner.tenant.tenantKey]);
      expect(stored[0]?.n).toBe('0');
      expect(sent).toEqual([]);

      const { asset } = await createWallet(owner.appuser, [{ address: BTC.segwit, chain: 'bitcoin' }]);
      const added = await http.as(owner.appuser).post(`/v1/manual-assets/${asset.manualAssetKey}/addresses`).send({ address: secret, chain: 'bitcoin' });
      expect(added.status).toBe(400);
      expect(added.body.code).toBe('crypto_wallet_secret_rejected');
      expect(JSON.stringify(added.body)).not.toContain(fingerprint);
      const rows = await db.em().getConnection().execute<{ address: string }[]>('select address from crypto_wallet_address');
      expect(rows.map((row) => row.address)).toEqual([BTC.segwit]);
    });

    it('refuses an address that is not valid for its chain, and one already on the wallet', async () => {
      const owner = await household();
      const invalid = await http.as(owner.appuser).post('/v1/manual-assets/crypto-wallets').send({ addresses: [{ address: ETH.checksummed, chain: 'bitcoin' }], name: 'Mixed up' });
      expect(invalid.status).toBe(400);
      expect(invalid.body).toMatchObject({ code: 'crypto_wallet_address_invalid', details: { addressIndex: '0' } });

      const { asset } = await createWallet(owner.appuser, [{ address: BTC.segwit, chain: 'bitcoin' }]);
      const again = await http.as(owner.appuser).post(`/v1/manual-assets/${asset.manualAssetKey}/addresses`).send({ address: BTC.segwit.toUpperCase(), chain: 'bitcoin' });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('crypto_wallet_address_exists');
    });
  });

  describe('switched off', () => {
    it('is off without explorer URLs: nothing is created and the job asks no one', async () => {
      const owner = await household();
      vi.stubEnv('CRYPTO_BTC_EXPLORER_URL', '');
      vi.stubEnv('CRYPTO_ETH_EXPLORER_URL', '');
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const response = await http.as(owner.appuser).post('/v1/manual-assets/crypto-wallets').send({ addresses: [{ address: BTC.segwit, chain: 'bitcoin' }], name: 'Cold storage' });

      expect(response.status).toBe(501);
      expect(response.body.code).toBe('feature_disabled');
      expect(await handleCryptoWalletSyncJob({ data: {}, id: 'job-1' } as Job<Partial<CryptoWalletSyncPayload>>, { em: db.em() })).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('offers only the chains whose explorer is set', async () => {
      const owner = await household();
      vi.stubEnv('CRYPTO_BTC_EXPLORER_URL', '');

      const btc = await http.as(owner.appuser).post('/v1/manual-assets/crypto-wallets').send({ addresses: [{ address: BTC.segwit, chain: 'bitcoin' }], name: 'Cold storage' });
      expect(btc.status).toBe(501);
      const { asset } = await createWallet(owner.appuser, [{ address: ETH.checksummed, chain: 'ethereum' }]);
      expect((await http.as(owner.appuser).post(`/v1/manual-assets/${asset.manualAssetKey}/addresses`).send({ address: BTC.segwit, chain: 'bitcoin' })).status).toBe(501);
    });
  });

  describe('as a manual asset', () => {
    it('takes no valuation by hand and no other kind, and goes with its addresses when deleted', async () => {
      const owner = await household();
      const { asset } = await createWallet(owner.appuser, [{ address: BTC.segwit, chain: 'bitcoin' }]);
      const path = `/v1/manual-assets/${asset.manualAssetKey}`;

      expect((await http.as(owner.appuser).post(`${path}/valuations`).send({ value: 1 })).body.code).toBe('crypto_wallet_value_synced');
      expect((await http.as(owner.appuser).patch(path).send({ kind: 'property' })).status).toBe(400);
      expect((await http.as(owner.appuser).post('/v1/manual-assets').send({ currencyKey: owner.currency.currencyKey, kind: 'crypto_wallet', name: 'Sneaky', value: 1 })).status).toBe(400);
      expect((await http.as(owner.appuser).patch(path).send({ name: 'Savings wallet' })).body.asset).toMatchObject({ name: 'Savings wallet' });

      expect((await http.as(owner.appuser).delete(path)).status).toBe(204);
      const rows = await db.em().getConnection().execute<{ n: string }[]>('select count(*)::text as n from crypto_wallet_address where deleted_at is null');
      expect(rows[0]?.n).toBe('0');
      expect(await syncCryptoWallet(db.em().fork(), asset.manualAssetKey, { prices: prices(), readers: {} })).toBeNull();
    });

    it('edits an address label and removes an address', async () => {
      const owner = await household();
      const { asset, wallet } = await createWallet(owner.appuser, [{ address: BTC.segwit, chain: 'bitcoin' }, { address: ETH.checksummed, chain: 'ethereum', label: 'Ledger' }]);
      const [btc, eth] = wallet.addresses;

      const relabelled = await http.as(owner.appuser).patch(`/v1/manual-assets/${asset.manualAssetKey}/addresses/${eth?.cryptoWalletAddressKey}`).send({ label: 'Trezor' });
      expect(relabelled.body.wallet.addresses[1]).toMatchObject({ label: 'Trezor' });
      const removed = await http.as(owner.appuser).delete(`/v1/manual-assets/${asset.manualAssetKey}/addresses/${btc?.cryptoWalletAddressKey}`);
      expect(removed.status).toBe(200);
      expect((removed.body as { wallet: WalletBody }).wallet.addresses.map((address) => address.chain)).toEqual(['ethereum']);
      expect((await http.as(owner.appuser).post(`/v1/manual-assets/${asset.manualAssetKey}/sync`)).status).toBe(202);
    });
  });

  describe('tenancy', () => {
    it('answers 404 to every wallet route from another household', async () => {
      const owner = await household();
      const neighbour = await seedHousehold(db.em());
      const { asset, wallet } = await createWallet(owner.appuser, [{ address: ETH.checksummed, chain: 'ethereum' }]);
      await sync(asset.manualAssetKey, { [ethUrl(ETH.checksummed)]: { body: blockscoutAddress(ETH.checksummed, '1000000000000000000') } });
      const addressKey = wallet.addresses[0]?.cryptoWalletAddressKey;
      const tokenKey = (await detail(owner.appuser, asset.manualAssetKey)).wallet.addresses[0]?.tokens[0]?.cryptoWalletTokenKey;
      const path = `/v1/manual-assets/${asset.manualAssetKey}`;
      const asNeighbour = http.as(neighbour.appuser);

      expect((await asNeighbour.get(path)).status).toBe(404);
      expect((await asNeighbour.post(`${path}/addresses`).send({ address: ETH.other, chain: 'ethereum' })).status).toBe(404);
      expect((await asNeighbour.patch(`${path}/addresses/${addressKey}`).send({ label: 'Mine' })).status).toBe(404);
      expect((await asNeighbour.delete(`${path}/addresses/${addressKey}`)).status).toBe(404);
      expect((await asNeighbour.patch(`${path}/tokens/${tokenKey}`).send({ tracked: false })).status).toBe(404);
      expect((await asNeighbour.post(`${path}/sync`)).status).toBe(404);

      const { wallet: after } = await detail(owner.appuser, asset.manualAssetKey);
      expect(after.addresses).toEqual([expect.objectContaining({ address: ETH.checksummed, label: null, tokens: [expect.objectContaining({ tracked: true })] })]);
    });

    it('does not reach another household\'s token through one\'s own wallet', async () => {
      const owner = await household();
      const neighbour = await seedHousehold(db.em());
      const mine = await createWallet(owner.appuser, [{ address: ETH.checksummed, chain: 'ethereum' }]);
      const theirs = await createWallet(neighbour.appuser, [{ address: ETH.other, chain: 'ethereum' }]);
      await sync(theirs.asset.manualAssetKey, { [ethUrl(ETH.other)]: { body: blockscoutAddress(ETH.other, '1') } });
      const theirToken = (await detail(neighbour.appuser, theirs.asset.manualAssetKey)).wallet.addresses[0]?.tokens[0]?.cryptoWalletTokenKey;
      const theirAddress = theirs.wallet.addresses[0]?.cryptoWalletAddressKey;

      expect((await http.as(owner.appuser).patch(`/v1/manual-assets/${mine.asset.manualAssetKey}/tokens/${theirToken}`).send({ tracked: false })).status).toBe(404);
      expect((await http.as(owner.appuser).delete(`/v1/manual-assets/${mine.asset.manualAssetKey}/addresses/${theirAddress}`)).status).toBe(404);
      expect((await detail(neighbour.appuser, theirs.asset.manualAssetKey)).wallet.addresses[0]?.tokens[0]?.tracked).toBe(true);
    });

    it('shares a wallet with the partner, who may tick its tokens, and hides a private one', async () => {
      const owner = await household();
      const partner = await addPartner(db.em(), owner);
      const shared = await createWallet(owner.appuser, [{ address: ETH.checksummed, chain: 'ethereum' }]);
      const secret = await createWallet(owner.appuser, [{ address: BTC.segwit, chain: 'bitcoin' }], { isPrivate: true, name: 'Mine alone' });
      await sync(shared.asset.manualAssetKey, { [ethUrl(ETH.checksummed)]: { body: blockscoutAddress(ETH.checksummed, '1') } });
      const token = (await detail(partner, shared.asset.manualAssetKey)).wallet.addresses[0]?.tokens[0];

      expect((await http.as(partner).patch(`/v1/manual-assets/${shared.asset.manualAssetKey}/tokens/${token?.cryptoWalletTokenKey}`).send({ tracked: false })).status).toBe(200);
      const listed = await http.as(partner).get('/v1/manual-assets');
      expect((listed.body.assets as { manualAssetKey: number }[]).map((asset) => asset.manualAssetKey)).toEqual([shared.asset.manualAssetKey]);
      const path = `/v1/manual-assets/${secret.asset.manualAssetKey}`;
      expect((await http.as(partner).get(path)).status).toBe(404);
      expect((await http.as(partner).post(`${path}/addresses`).send({ address: BTC.legacy, chain: 'bitcoin' })).status).toBe(404);
      expect((await http.as(partner).post(`${path}/sync`)).status).toBe(404);
      expect((await http.as(partner).delete(`${path}/addresses/${secret.wallet.addresses[0]?.cryptoWalletAddressKey}`)).status).toBe(404);
    });
  });
});
