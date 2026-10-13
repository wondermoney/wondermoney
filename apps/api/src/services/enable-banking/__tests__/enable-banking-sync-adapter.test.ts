import { beforeEach, describe, expect, it, vi } from 'vitest';

const { decryptCredentialEntity } = vi.hoisted(() => ({ decryptCredentialEntity: vi.fn(() => ({ applicationId: 'app-1', privateKeyPem: 'pem' })) }));
vi.mock('../enable-banking-credential.service', () => ({ enableBankingCredentialService: { decryptCredentialEntity } }));
vi.mock('../enable-banking-client.service', () => ({ createEnableBankingClient: vi.fn() }));

import type { EnableBankingConnection } from '@entity/EnableBankingConnection';

import type { EnableBankingClient } from '../enable-banking-client.service';
import { createEnableBankingSyncAdapter } from '../enable-banking-sync-adapter';

type AdapterEm = NonNullable<NonNullable<Parameters<typeof createEnableBankingSyncAdapter>[1]>['em']>;

interface FakeAccount { accountId: string; accountName?: string; accountNumber?: string; currencyKey?: { code: string }; holderName?: string }

const connection = { aspspCountry: 'PT', aspspName: 'Caixa Geral de Depósitos', enableBankingCredentialKey: {} } as unknown as EnableBankingConnection;

function client(overrides: Partial<{ balances: unknown; transactionPages: unknown[] }> = {}) {
  const getAccountTransactions = vi.fn();
  const pages = overrides.transactionPages ?? [{ transactions: [] }];
  for (const [index, page] of pages.entries()) {
    if (index === pages.length - 1) getAccountTransactions.mockResolvedValueOnce(page);
    else getAccountTransactions.mockResolvedValueOnce(page);
  }
  return {
    getAccountBalances: vi.fn().mockResolvedValue(overrides.balances ?? { balances: [] }),
    getAccountTransactions,
  };
}

function em(accounts: FakeAccount[]) {
  const find = vi.fn().mockResolvedValue(accounts);
  return { find };
}

beforeEach(() => vi.clearAllMocks());

describe('createEnableBankingSyncAdapter', () => {
  describe('account discovery (requisition.getRequisitionById)', () => {
    it('lists account ids from already-persisted Account rows, not a live provider call', async () => {
      const testEm = em([{ accountId: 'acc-1' }, { accountId: 'acc-2' }]);
      const adapter = createEnableBankingSyncAdapter(connection, { client: client() as unknown as EnableBankingClient, em: testEm as unknown as AdapterEm });

      const result = await adapter.requisition.getRequisitionById('ignored');

      expect(result.accounts).toEqual(['acc-1', 'acc-2']);
      expect(result.institution_id).toBe('enable_banking:pt:caixa-geral-de-depositos');
    });

    it('filters out accounts with no accountId', async () => {
      const testEm = em([{ accountId: 'acc-1' }, { accountId: undefined as unknown as string }]);
      const adapter = createEnableBankingSyncAdapter(connection, { client: client() as unknown as EnableBankingClient, em: testEm as unknown as AdapterEm });

      const result = await adapter.requisition.getRequisitionById('ignored');

      expect(result.accounts).toEqual(['acc-1']);
    });

    it('memoizes the accounts query across calls', async () => {
      const testEm = em([{ accountId: 'acc-1' }]);
      const adapter = createEnableBankingSyncAdapter(connection, { client: client() as unknown as EnableBankingClient, em: testEm as unknown as AdapterEm });

      await adapter.requisition.getRequisitionById('ignored');
      await adapter.account('acc-1').getDetails();
      await adapter.account('acc-1').getMetadata();

      expect(testEm.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('account details / metadata (sourced from persisted Account rows)', () => {
    it('reads currency, name, ownerName, iban, and a stable institution id off the matching Account', async () => {
      const testEm = em([{ accountId: 'acc-1', accountName: 'Current Account', accountNumber: 'PT50000000000000000000000', currencyKey: { code: 'EUR' }, holderName: 'Jane Doe' }]);
      const adapter = createEnableBankingSyncAdapter(connection, { client: client() as unknown as EnableBankingClient, em: testEm as unknown as AdapterEm });

      const details = await adapter.account('acc-1').getDetails();
      const metadata = await adapter.account('acc-1').getMetadata();

      expect(details).toEqual({ account: { currency: 'EUR', name: 'Current Account', ownerName: 'Jane Doe' } });
      expect(metadata).toEqual({ iban: 'PT50000000000000000000000', institution_id: 'enable_banking:pt:caixa-geral-de-depositos' });
    });

    it('returns undefined fields rather than throwing when no matching Account row exists yet', async () => {
      const testEm = em([]);
      const adapter = createEnableBankingSyncAdapter(connection, { client: client() as unknown as EnableBankingClient, em: testEm as unknown as AdapterEm });

      const details = await adapter.account('missing').getDetails();

      expect(details.account?.currency).toBeUndefined();
      expect(details.account?.name).toBeUndefined();
    });
  });

  describe('balances (balance_type ISO 20022 → Berlin-Group camelCase)', () => {
    it('maps every documented Enable Banking balance_type the preference list recognizes', async () => {
      const raw = {
        balances: [
          { balance_amount: { amount: '10.00' }, balance_type: 'CLBD' },
          { balance_amount: { amount: '20.00' }, balance_type: 'ITBD' },
          { balance_amount: { amount: '30.00' }, balance_type: 'OPBD' },
          { balance_amount: { amount: '40.00' }, balance_type: 'XPCD' },
          { balance_amount: { amount: '50.00' }, balance_type: 'ITAV' },
          { balance_amount: { amount: '60.00' }, balance_type: 'FWAV' },
        ],
      };
      const testEm = em([{ accountId: 'acc-1' }]);
      const adapter = createEnableBankingSyncAdapter(connection, { client: client({ balances: raw }) as unknown as EnableBankingClient, em: testEm as unknown as AdapterEm });

      const result = await adapter.account('acc-1').getBalances();

      expect(result.balances).toEqual([
        { balanceAmount: { amount: '10.00' }, balanceType: 'closingBooked' },
        { balanceAmount: { amount: '20.00' }, balanceType: 'interimBooked' },
        { balanceAmount: { amount: '30.00' }, balanceType: 'openingBooked' },
        { balanceAmount: { amount: '40.00' }, balanceType: 'expected' },
        { balanceAmount: { amount: '50.00' }, balanceType: 'interimAvailable' },
        { balanceAmount: { amount: '60.00' }, balanceType: 'forwardAvailable' },
      ]);
    });

    it('passes through an unmapped/unknown balance_type unchanged (relies on the existing "first usable" fallback)', async () => {
      const raw = { balances: [{ balance_amount: { amount: '5.00' }, balance_type: 'CLAV' }] };
      const testEm = em([{ accountId: 'acc-1' }]);
      const adapter = createEnableBankingSyncAdapter(connection, { client: client({ balances: raw }) as unknown as EnableBankingClient, em: testEm as unknown as AdapterEm });

      const result = await adapter.account('acc-1').getBalances();

      expect(result.balances).toEqual([{ balanceAmount: { amount: '5.00' }, balanceType: 'CLAV' }]);
    });

    it('returns an empty balances array when the provider returns none', async () => {
      const testEm = em([{ accountId: 'acc-1' }]);
      const adapter = createEnableBankingSyncAdapter(connection, { client: client({ balances: {} }) as unknown as EnableBankingClient, em: testEm as unknown as AdapterEm });

      const result = await adapter.account('acc-1').getBalances();

      expect(result.balances).toEqual([]);
    });
  });

  describe('transactions (flat status: BOOK|PEND → booked/pending split; field renames)', () => {
    it('splits booked and pending, renames fields, maps credit/debit indicator, and joins remittance_information', async () => {
      const raw = {
        transactions: [
          {
            booking_date: '2026-01-01',
            credit_debit_indicator: 'CRDT',
            creditor: { name: 'Acme Corp' },
            debtor: { name: 'Jane Doe' },
            entry_reference: 'entry-1',
            remittance_information: ['Invoice', '1234'],
            status: 'BOOK',
            transaction_amount: { amount: '100.00', currency: 'EUR' },
            transaction_id: 'tx-1',
            value_date: '2026-01-01',
          },
          {
            booking_date: '2026-01-02',
            credit_debit_indicator: 'DBTR',
            entry_reference: 'entry-2',
            status: 'PEND',
            transaction_amount: { amount: '15.50', currency: 'EUR' },
          },
        ],
      };
      const testEm = em([{ accountId: 'acc-1' }]);
      const adapter = createEnableBankingSyncAdapter(connection, { client: client({ transactionPages: [raw] }) as unknown as EnableBankingClient, em: testEm as unknown as AdapterEm });

      const result = await adapter.account('acc-1').getTransactions({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });

      expect(result.transactions?.booked).toEqual([{
        bookingDate: '2026-01-01',
        creditDebitIndicator: 'credit',
        creditorName: 'Acme Corp',
        debtorName: 'Jane Doe',
        entryReference: 'entry-1',
        remittanceInformationUnstructured: 'Invoice 1234',
        transactionAmount: { amount: '100.00', currency: 'EUR' },
        transactionId: 'tx-1',
        valueDate: '2026-01-01',
      }]);
      expect(result.transactions?.pending).toEqual([{
        bookingDate: '2026-01-02',
        creditDebitIndicator: 'debit',
        creditorName: undefined,
        debtorName: undefined,
        entryReference: 'entry-2',
        remittanceInformationUnstructured: undefined,
        transactionAmount: { amount: '15.50', currency: 'EUR' },
        transactionId: undefined,
        valueDate: undefined,
      }]);
    });

    it('exhausts continuation_key pagination internally and returns one complete, already-split result', async () => {
      const page1 = { continuation_key: 'cursor-1', transactions: [{ status: 'BOOK', transaction_id: 'tx-1' }] };
      const page2 = { continuation_key: 'cursor-2', transactions: [{ status: 'PEND', transaction_id: 'tx-2' }] };
      const page3 = { transactions: [{ status: 'BOOK', transaction_id: 'tx-3' }] };
      const testEm = em([{ accountId: 'acc-1' }]);
      const testClient = client({ transactionPages: [page1, page2, page3] });
      const adapter = createEnableBankingSyncAdapter(connection, { client: testClient as unknown as EnableBankingClient, em: testEm as unknown as AdapterEm });

      const result = await adapter.account('acc-1').getTransactions({});

      expect(testClient.getAccountTransactions).toHaveBeenCalledTimes(3);
      expect(testClient.getAccountTransactions).toHaveBeenNthCalledWith(1, 'acc-1', { continuationKey: undefined, dateFrom: undefined, dateTo: undefined });
      expect(testClient.getAccountTransactions).toHaveBeenNthCalledWith(2, 'acc-1', { continuationKey: 'cursor-1', dateFrom: undefined, dateTo: undefined });
      expect(testClient.getAccountTransactions).toHaveBeenNthCalledWith(3, 'acc-1', { continuationKey: 'cursor-2', dateFrom: undefined, dateTo: undefined });
      expect(result.transactions?.booked?.map((row) => row.transactionId)).toEqual(['tx-1', 'tx-3']);
      expect(result.transactions?.pending?.map((row) => row.transactionId)).toEqual(['tx-2']);
    });

    it('throws rather than looping forever if continuation_key never terminates', async () => {
      const testEm = em([{ accountId: 'acc-1' }]);
      const infiniteClient = { getAccountBalances: vi.fn(), getAccountTransactions: vi.fn().mockResolvedValue({ continuation_key: 'always-more', transactions: [] }) };
      const adapter = createEnableBankingSyncAdapter(connection, { client: infiniteClient as unknown as EnableBankingClient, em: testEm as unknown as AdapterEm });

      await expect(adapter.account('acc-1').getTransactions({})).rejects.toThrow(/did not terminate/);
    });

    it('produces a stable transactionId identity for dedup (Enable Banking transaction_id passthrough)', async () => {
      const raw = { transactions: [{ status: 'BOOK', transaction_id: 'unique-tx-id' }] };
      const testEm = em([{ accountId: 'acc-1' }]);
      const adapter = createEnableBankingSyncAdapter(connection, { client: client({ transactionPages: [raw] }) as unknown as EnableBankingClient, em: testEm as unknown as AdapterEm });

      const result = await adapter.account('acc-1').getTransactions({});

      expect(result.transactions?.booked?.[0]?.transactionId).toBe('unique-tx-id');
    });
  });

  it('builds the low-level client from the connection credential when none is injected', async () => {
    const { createEnableBankingClient } = await import('../enable-banking-client.service');
    vi.mocked(createEnableBankingClient).mockReturnValue(client() as unknown as EnableBankingClient);
    const testEm = em([{ accountId: 'acc-1' }]);

    createEnableBankingSyncAdapter(connection, { em: testEm as unknown as AdapterEm });

    expect(decryptCredentialEntity).toHaveBeenCalledWith((connection as { enableBankingCredentialKey: unknown }).enableBankingCredentialKey);
    expect(createEnableBankingClient).toHaveBeenCalledWith({ applicationId: 'app-1', privateKeyPem: 'pem' });
  });
});
