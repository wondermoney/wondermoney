import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { EnableBankingReturnTo } from '@app/types/enable-banking-return-to';
import { AccountFinancialInstitutionProvider } from '@entity/AccountFinancialInstitution';
import { Appuser } from '@entity/Appuser';
import { BankConnection } from '@entity/BankConnection';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { Tenant } from '@entity/Tenant';
import { createEnableBankingClient } from '@service/enable-banking/enable-banking-client.service';
import { enableBankingCredentialService } from '@service/enable-banking/enable-banking-credential.service';
import { createInitialEnableBankingAccounts } from '@service/enable-banking/enable-banking-initial-accounts.service';
import { createEnableBankingSyncAdapter } from '@service/enable-banking/enable-banking-sync-adapter';
import { getRef } from '@utils/em-helpers';
import { buildEnableBankingInstitutionRecordId, decodeEnableBankingInstitutionId, encodeEnableBankingInstitutionId } from '@utils/enable-banking-institution-id';
import { BadRequestError, InternalServerError, NotFoundError } from '@utils/errors';

import { ConsentExpiredError, RateLimitedError, UnavailableError, UserActionRequiredError } from './errors';
import type {
  BankAccountsResult,
  BankCompleteConnectionInput,
  BankCompleteConnectionResult,
  BankConnectionInstitution,
  BankConnectionRef,
  BankInstitution,
  BankProvider,
  BankProviderBalance,
  BankProviderTransactions,
  BankSessionStatus,
  BankStartConnectionInput,
  BankStartConnectionResult,
  BankTransactionsInput,
} from './types';

/**
 * Enable Banking behind the `BankProvider` interface. It is the first implementation and must
 * keep the behaviour the sync services had before the seam existed: the shape translation
 * stays in `enable-banking-sync-adapter.ts`, and every provider failure is mapped to one of the
 * typed errors here so the sync path never sees an Axios or Enable Banking shape.
 */
class EnableBankingProvider implements BankProvider {
  readonly id = 'enable_banking';
  readonly institutionProvider = AccountFinancialInstitutionProvider.ENABLE_BANKING;
  readonly transactionIdentity = { column: 'enableBankingTransactionId' as const, prefix: 'enable_banking' as const };

  async completeConnection(input: BankCompleteConnectionInput): Promise<BankCompleteConnectionResult> {
    const repository = DI.em.getRepository(EnableBankingConnection);
    const connection = await repository.findByState(input.state);
    if (!connection) throw new NotFoundError('Enable Banking connection not found');

    let client;
    try {
      client = createEnableBankingClient(enableBankingCredentialService.decryptForConnection(connection));
    } catch (error) {
      await repository.changeToError(connection);
      throw mapEnableBankingError(error);
    }
    let session;
    try {
      session = await client.exchangeSession(input.code);
    } catch (error) {
      await repository.changeToError(connection);
      throw mapEnableBankingError(error);
    }

    await repository.changeToLinked(connection, session.sessionId, new Date(session.access.validUntil), connection.maxConsentValiditySeconds);
    let accountResult;
    try {
      accountResult = await createInitialEnableBankingAccounts(DI.em, connection, session.accounts);
    } catch (error) {
      return { accountsCreated: 0, bankConnectionKey: bankConnectionKeyOf(connection), postLinkError: error, returnTo: connection.returnTo ?? null };
    }

    return {
      accountsCreated: accountResult.accountsCreated,
      bankConnectionKey: bankConnectionKeyOf(connection),
      returnTo: connection.returnTo ?? null,
    };
  }

  /** The ASPSP name and country stored on each Enable Banking row; its id is the one the sync records. */
  async describeInstitutions(em: EntityManager, bankConnectionKeys: number[]): Promise<Map<number, BankConnectionInstitution>> {
    const institutions = new Map<number, BankConnectionInstitution>();
    if (bankConnectionKeys.length === 0) return institutions;
    const rows = await em.find(
      EnableBankingConnection,
      { bankConnectionKey: { bankConnectionKey: { $in: bankConnectionKeys } } },
      { fields: ['aspspCountry', 'aspspName', 'bankConnectionKey'] },
    );
    for (const row of rows) {
      const key = (row.bankConnectionKey as unknown as undefined | { bankConnectionKey?: number })?.bankConnectionKey;
      if (!key) continue;
      institutions.set(key, {
        country: row.aspspCountry,
        id: buildEnableBankingInstitutionRecordId({ country: row.aspspCountry, name: row.aspspName }),
        name: row.aspspName,
      });
    }
    return institutions;
  }

  async getBalances(connection: BankConnectionRef, accountId: string): Promise<BankProviderBalance[]> {
    const detail = await this.detailOf(connection);
    if (!detail) throw new NotFoundError('Enable Banking connection not found');
    try {
      const response = await createEnableBankingSyncAdapter(detail).account(accountId).getBalances();
      return response.balances ?? [];
    } catch (error) {
      throw mapEnableBankingError(error);
    }
  }

  async getSessionStatus(connection: BankConnectionRef): Promise<BankSessionStatus> {
    const detail = await this.detailOf(connection);
    if (!detail?.sessionId) return 'unknown';
    try {
      const { status } = await this.clientFor(detail).getSession(detail.sessionId);
      return status === 'AUTHORIZED' ? 'active' : 'ended';
    } catch {
      // A failed session lookup says nothing about the consent.
      return 'unknown';
    }
  }

  async getTransactions(connection: BankConnectionRef, accountId: string, input?: BankTransactionsInput): Promise<BankProviderTransactions> {
    const detail = await this.detailOf(connection);
    if (!detail) throw new NotFoundError('Enable Banking connection not found');
    try {
      const response = await createEnableBankingSyncAdapter(detail).account(accountId).getTransactions(input);
      return response.transactions ?? {};
    } catch (error) {
      throw mapEnableBankingError(error);
    }
  }

  async listAccounts(connection: BankConnectionRef): Promise<BankAccountsResult> {
    const detail = await this.detailOf(connection);
    if (!detail) throw new NotFoundError('Enable Banking connection not found');
    const adapter = createEnableBankingSyncAdapter(detail);
    const requisition = await adapter.requisition.getRequisitionById(detail.sessionId ?? detail.state);
    const accounts = await Promise.all((requisition.accounts ?? []).map(async (accountId) => {
      const [details, metadata] = await Promise.all([
        adapter.account(accountId).getDetails(),
        adapter.account(accountId).getMetadata(),
      ]);
      return {
        currency: details.account?.currency,
        externalId: accountId,
        iban: metadata.iban,
        institutionId: metadata.institution_id,
        name: details.account?.name,
        ownerName: details.account?.ownerName,
      };
    }));
    return {
      accounts,
      institutionId: requisition.institution_id,
      providerStatus: (requisition as { status?: string }).status,
    };
  }

  async listInstitutions(input: { appuserId: number; country?: string; tenantId?: number }): Promise<BankInstitution[]> {
    const resolved = await enableBankingCredentialService.resolveForNewLink(input.appuserId, input.tenantId);
    if (!resolved) throw new BadRequestError('No Enable Banking credential configured');
    const client = createEnableBankingClient(resolved.credential);
    try {
      const institutions = await client.listInstitutions({ country: input.country });
      return institutions.map((institution) => ({
        country: institution.country,
        id: encodeEnableBankingInstitutionId({ country: institution.country, name: institution.name }),
        logo: institution.logo ?? '',
        name: institution.name,
      }));
    } catch (error) {
      throw mapEnableBankingError(error);
    }
  }

  async preflight(connection: BankConnectionRef): Promise<void> {
    const detail = await this.detailOf(connection);
    if (!detail) throw new UserActionRequiredError('Enable Banking connection not found');
    try {
      enableBankingCredentialService.decryptForConnection(detail);
    } catch (error) {
      throw new UserActionRequiredError(error instanceof Error ? error.message : 'Enable Banking credential could not be decrypted');
    }
  }

  async startConnection(input: BankStartConnectionInput): Promise<BankStartConnectionResult> {
    const institutionRef = decodeEnableBankingInstitutionId(input.institutionId);
    if (!institutionRef) throw new BadRequestError('Invalid institution id');

    // The user's own credential wins; otherwise the instance one, when this household may use it.
    const resolved = await enableBankingCredentialService.resolveForNewLink(input.appuserId, input.tenantId);
    if (!resolved) throw new BadRequestError('No Enable Banking credential configured');
    const client = createEnableBankingClient(resolved.credential);

    // `maximum_consent_validity` varies per bank and is never hardcoded.
    let institution;
    try {
      const institutions = await client.listInstitutions({ country: institutionRef.country });
      institution = institutions.find((candidate) => candidate.name === institutionRef.name);
    } catch (error) {
      throw mapEnableBankingError(error);
    }
    if (!institution) throw new NotFoundError('Institution not found');
    const maxConsentValiditySeconds = institution.maximum_consent_validity;
    if (!maxConsentValiditySeconds) throw new InternalServerError('Enable Banking did not return a maximum consent validity for this institution');

    const tenant = await DI.em.findOne(Tenant, { tenantKey: input.tenantId });
    if (!tenant) throw new NotFoundError('Tenant not found');
    const appuser = await DI.em.findOneOrFail(Appuser, { appuserKey: input.appuserId });
    const state = randomUUID();
    const validUntil = new Date(Date.now() + maxConsentValiditySeconds * 1000).toISOString();

    let authorization;
    try {
      authorization = await client.startAuthorization({
        aspsp: { country: institutionRef.country, name: institutionRef.name },
        psuType: 'personal',
        redirectUrl: input.redirectUrl,
        state,
        validUntil,
      });
    } catch (error) {
      throw mapEnableBankingError(error);
    }

    await DI.em.getRepository(EnableBankingConnection).createConnection(
      appuser,
      tenant,
      resolved.entity,
      state,
      institutionRef.name,
      institutionRef.country,
      maxConsentValiditySeconds,
      input.returnTo === EnableBankingReturnTo.MOBILE ? EnableBankingReturnTo.MOBILE : null,
    );

    return { redirectUrl: authorization.url };
  }

  private clientFor(connection: EnableBankingConnection) {
    return createEnableBankingClient(enableBankingCredentialService.decryptForConnection(connection));
  }

  private detailOf(connection: BankConnectionRef): Promise<EnableBankingConnection | null> {
    return DI.em.findOne(
      EnableBankingConnection,
      { bankConnectionKey: getRef(DI.em, BankConnection, connection.bankConnectionKey), deletedAt: undefined },
      { populate: ['appuserKey', 'bankConnectionKey', 'enableBankingCredentialKey', 'tenantKey'] },
    );
  }
}

/** The `bankConnectionKey` of an Enable Banking row, throwing if the backfill has not run. */
function bankConnectionKeyOf(connection: EnableBankingConnection): number {
  const key = (connection.bankConnectionKey as unknown as undefined | { bankConnectionKey?: number })?.bankConnectionKey;
  if (!key) throw new Error('Enable Banking connection has no BankConnection row; run the start-up backfill');
  return key;
}

/**
 * Map Enable Banking/Axios failures onto the interface's typed errors. `status` is kept so the
 * pre-existing `provider-failure.ts` classifiers keep working unchanged.
 */
function mapEnableBankingError(error: unknown) {
  if (error instanceof ConsentExpiredError || error instanceof RateLimitedError || error instanceof UnavailableError || error instanceof UserActionRequiredError) return error;
  const status = (error as null | { status?: unknown })?.status;
  if (status === 429) return new RateLimitedError('Enable Banking rate limit reached', (error as { retryAfter?: number }).retryAfter);
  if (status === 401) return new ConsentExpiredError('Enable Banking credential or consent is no longer valid');
  if (status === 400 || status === 404) return new UserActionRequiredError('Enable Banking rejected the request; the user must reconnect');
  if (status === 502 || status === 503 || status === 504) return new UnavailableError('Enable Banking is temporarily unavailable');
  return new UnavailableError(error instanceof Error ? error.message : 'Enable Banking request failed');
}

export const enableBankingProvider = new EnableBankingProvider();
