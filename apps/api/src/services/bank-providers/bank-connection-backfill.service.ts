import type { EntityManager } from '@mikro-orm/postgresql';

import { Account } from '@entity/Account';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { EnableBankingConnection, INSTANCE_CREDENTIAL_REFERENCE } from '@entity/EnableBankingConnection';

/**
 * Move existing Enable Banking connections onto the provider-agnostic `BankConnection` table.
 *
 * Migrations are DDL only in this repository, so the data move lives here and runs from
 * `migrate.ts` after the migrations, on every start. It is idempotent and transactional:
 *  - an Enable Banking row without a `bankConnectionKey` gets one `BankConnection` row;
 *  - every account still pointing only at `enableBankingConnectionKey` is stamped with the
 *    matching `bankConnectionKey`;
 *  - a second run finds nothing to do and changes nothing.
 *
 * The legacy columns stay (out of scope to remove them); this only adds the new pointer, so a
 * connection keeps syncing through the provider interface after the upgrade.
 */
export interface BankConnectionBackfillResult {
  accountsStamped: number;
  connectionsCreated: number;
}

export async function backfillBankConnections(em: EntityManager): Promise<BankConnectionBackfillResult> {
  return em.transactional(async (tx) => {
    const unlinked = await tx.find(
      EnableBankingConnection,
      { bankConnectionKey: null },
      { populate: ['appuserKey', 'enableBankingCredentialKey', 'tenantKey'] },
    );

    let connectionsCreated = 0;
    for (const connection of unlinked) {
      const bankConnection = new BankConnection();
      bankConnection.accessValidUntil = connection.accessValidUntil;
      bankConnection.appuserKey = connection.appuserKey;
      bankConnection.credentialReference = credentialReferenceOf(connection);
      bankConnection.externalId = connection.sessionId ?? connection.state;
      bankConnection.lastSyncAttemptAt = connection.lastSyncAttemptAt;
      bankConnection.maxConsentValiditySeconds = connection.maxConsentValiditySeconds;
      bankConnection.nextEligibleSyncAt = connection.nextEligibleSyncAt;
      bankConnection.provider = 'enable_banking';
      bankConnection.state = connection.state;
      bankConnection.status = connection.status as unknown as BankConnectionStatus;
      bankConnection.tenantKey = connection.tenantKey;
      tx.persist(bankConnection);
      await tx.flush();
      connection.bankConnectionKey = bankConnection;
      await tx.flush();
      connectionsCreated += 1;
    }

    // Accounts are stamped for every linked Enable Banking row, including rows a previous run
    // already migrated: a crash between the two steps must not leave accounts behind.
    const linked = await tx.find(
      EnableBankingConnection,
      { bankConnectionKey: { $ne: null } },
      { populate: ['bankConnectionKey'] },
    );
    let accountsStamped = 0;
    for (const connection of linked) {
      const bankConnection = connection.bankConnectionKey;
      if (!bankConnection) continue;
      accountsStamped += await tx.nativeUpdate(
        Account,
        { bankConnectionKey: null, enableBankingConnectionKey: connection },
        { bankConnectionKey: bankConnection },
      );
    }

    return { accountsStamped, connectionsCreated };
  });
}

/**
 * The credential row's key as a string. `credentialReference` is provider-specific by design:
 * Enable Banking stores the `EnableBankingCredential` key, or `instance` for a connection made
 * with the instance-wide credential, and the provider implementation resolves the row itself.
 */
function credentialReferenceOf(connection: EnableBankingConnection): string | undefined {
  const credential = connection.enableBankingCredentialKey as unknown as
    | null
    | number
    | undefined
    | { enableBankingCredentialKey?: number; id?: number };
  if (credential === null) return INSTANCE_CREDENTIAL_REFERENCE;
  if (typeof credential === 'number') return String(credential);
  const key = credential?.enableBankingCredentialKey ?? credential?.id;
  return key === undefined ? undefined : String(key);
}
