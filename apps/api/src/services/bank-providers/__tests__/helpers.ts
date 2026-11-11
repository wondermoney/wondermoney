import { AccountFinancialInstitutionProvider } from '@entity/AccountFinancialInstitution';
import { BankConnectionStatus } from '@entity/BankConnection';

import type { BankConnectionRef, BankProvider, BankProviderBalance, BankProviderTransaction, BankProviderTransactions } from '../types';

/** A linked connection ref for the sync-service tests. */
interface FakeAccountClient {
  getBalances?: () => Promise<{ balances?: BankProviderBalance[] }>;
  getDetails?: () => Promise<{ account?: { currency?: string; name?: string; ownerName?: string } }>;
  getMetadata?: () => Promise<{ iban?: string; institution_id?: string }>;
  getTransactions?: (input?: { country?: string; dateFrom?: string; dateTo?: string }) => Promise<BankProviderTransactions | { transactions?: BankProviderTransactions }>;
}

interface FakeClient {
  account: (accountId: string) => FakeAccountClient;
  requisition?: { getRequisitionById: (id: string) => Promise<{ accounts?: string[]; institution_id?: string; status?: string }> };
}

export function connectionRef(bankConnectionKey = 1, overrides: Partial<BankConnectionRef> = {}): BankConnectionRef {
  return {
    appuserId: 9,
    bankConnectionKey,
    externalId: 'sess-1',
    provider: 'enable_banking',
    status: BankConnectionStatus.LINKED,
    tenantId: 3,
    ...overrides,
  };
}

/**
 * Adapt the old `{account(id): {getBalances, getDetails, getMetadata, getTransactions}, requisition}`
 * fake client the sync-service tests were written against into a `BankProvider`. It keeps the
 * test fixtures readable while proving the services go through the interface.
 */
export function providerFromClient(client: FakeClient): BankProvider {
  return {
    completeConnection: () => Promise.reject(new Error('not used in sync tests')),
    getBalances: async (_connection, accountId) => (await client.account(accountId).getBalances?.())?.balances ?? [],
    getSessionStatus: () => Promise.resolve('active'),
    getTransactions: async (_connection, accountId, input) => {
      const response = await client.account(accountId).getTransactions?.(input);
      if (!response) return {};
      return 'transactions' in response && response.transactions ? response.transactions : response as BankProviderTransactions;
    },
    id: 'enable_banking',
    institutionProvider: AccountFinancialInstitutionProvider.ENABLE_BANKING,
    listAccounts: async () => {
      const requisition = await client.requisition?.getRequisitionById('sess-1') ?? {};
      const accounts = await Promise.all((requisition.accounts ?? []).map(async (accountId) => {
        const account = client.account(accountId);
        const details = (await account.getDetails?.()) ?? { account: undefined };
        const metadata = (await account.getMetadata?.()) ?? { iban: undefined, institution_id: undefined };
        return {
          currency: details.account?.currency,
          externalId: accountId,
          iban: metadata.iban,
          institutionId: metadata.institution_id,
          name: details.account?.name,
          ownerName: details.account?.ownerName,
        };
      }));
      return { accounts, institutionId: requisition.institution_id, providerStatus: requisition.status };
    },
    listInstitutions: () => Promise.resolve([]),
    startConnection: () => Promise.reject(new Error('not used in sync tests')),
    transactionIdentity: { column: 'enableBankingTransactionId', prefix: 'enable_banking' },
  };
}

export type { BankProviderTransaction };
