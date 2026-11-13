import { QueryOrder } from '@mikro-orm/core';

import { Appuser } from '../entity/Appuser';
import { BankConnection, BankConnectionStatus } from '../entity/BankConnection';
import { EnableBankingConnection, EnableBankingConnectionStatus, INSTANCE_CREDENTIAL_REFERENCE } from '../entity/EnableBankingConnection';
import { EnableBankingCredential } from '../entity/EnableBankingCredential';
import { Tenant } from '../entity/Tenant';

import { ExtendedEntityRepository } from './_ExtendedEntityRepository';

export class EnableBankingConnectionRepository extends ExtendedEntityRepository<EnableBankingConnection> {
  public changeToAuthorized = async (connection: EnableBankingConnection, authorizationId: EnableBankingConnection['authorizationId']) => {
    connection.authorizationId = authorizationId;
    connection.status = EnableBankingConnectionStatus.AUTHORIZED;
    await this.persist(connection).flush();
    return connection;
  };

  public changeToError = async (connection: EnableBankingConnection) => {
    connection.status = EnableBankingConnectionStatus.ERROR;
    const bankConnection = await this.bankConnectionOf(connection);
    if (bankConnection) bankConnection.status = BankConnectionStatus.ERROR;
    await this.persist(connection).flush();
    return connection;
  };

  /**
   * Persists the *real* provider-returned `access.valid_until` and
   * `maximum_consent_validity` (read per-bank from `GET /aspsps`) rather than a
   * hardcoded offset: both values here are required parameters the caller must
   * obtain from Enable Banking's own response, never computed locally.
   */
  public changeToLinked = async (
    connection: EnableBankingConnection,
    sessionId: EnableBankingConnection['sessionId'],
    accessValidUntil: NonNullable<EnableBankingConnection['accessValidUntil']>,
    maxConsentValiditySeconds: EnableBankingConnection['maxConsentValiditySeconds'],
  ) => {
    connection.sessionId = sessionId;
    connection.accessValidUntil = accessValidUntil;
    connection.maxConsentValiditySeconds = maxConsentValiditySeconds;
    connection.status = EnableBankingConnectionStatus.LINKED;
    const bankConnection = await this.bankConnectionOf(connection);
    if (bankConnection) {
      bankConnection.externalId = sessionId;
      bankConnection.accessValidUntil = accessValidUntil;
      bankConnection.maxConsentValiditySeconds = maxConsentValiditySeconds;
      bankConnection.status = BankConnectionStatus.LINKED;
    }
    await this.persist(connection).flush();
    return connection;
  };

  /**
   * Dual-write the resolved tenant alongside the owner when creating a new
   * connection: the tenant is sourced from the active tenant context
   * (`req.tenant`), never from a membership lookup, so household
   * account-sharing keeps working even though the *credential* itself is
   * personal (BYOK, one Enable Banking application per user). `credential` is null for a link
   * made with the instance-wide credential.
   */
  public createConnection = async (
    appuser: Appuser,
    tenant: Tenant,
    credential: EnableBankingCredential | null,
    state: EnableBankingConnection['state'],
    aspspName: EnableBankingConnection['aspspName'],
    aspspCountry: EnableBankingConnection['aspspCountry'],
    maxConsentValiditySeconds?: EnableBankingConnection['maxConsentValiditySeconds'],
    returnTo: EnableBankingConnection['returnTo'] = null,
  ) => {
    if (!Number.isInteger(tenant.tenantKey) || tenant.tenantKey <= 0) {
      throw new Error('Connection tenant is required and must be a persisted Tenant');
    }
    const connection = new EnableBankingConnection();
    connection.appuserKey = appuser;
    connection.tenantKey = tenant;
    connection.enableBankingCredentialKey = credential;
    connection.state = state;
    connection.aspspName = aspspName;
    connection.aspspCountry = aspspCountry;
    connection.maxConsentValiditySeconds = maxConsentValiditySeconds;
    connection.returnTo = returnTo;
    connection.status = EnableBankingConnectionStatus.CREATED;

    // The provider-agnostic row the sync path reads. Created alongside the Enable Banking row
    // so a new connection never depends on the start-up backfill.
    const bankConnection = new BankConnection();
    bankConnection.provider = 'enable_banking';
    bankConnection.appuserKey = appuser;
    bankConnection.tenantKey = tenant;
    bankConnection.credentialReference = credential ? String(credential.enableBankingCredentialKey) : INSTANCE_CREDENTIAL_REFERENCE;
    bankConnection.state = state;
    bankConnection.maxConsentValiditySeconds = maxConsentValiditySeconds;
    bankConnection.status = BankConnectionStatus.CREATED;
    await this.persist(bankConnection).flush();
    connection.bankConnectionKey = bankConnection;

    await this.persist(connection).flush();
    return connection;
  };

  /**
   * Find a connection by its callback correlation value (`state`), regardless of
   * status — used by the Enable Banking callback handler, which must locate the
   * `created` row a `startBankConnection` call left behind. Populates the owning
   * appuser/tenant and the credential (needed to decrypt and resume the provider
   * call), matching what the callback needs in one query.
   */
  public findByState = (state: EnableBankingConnection['state']) => {
    return this.findOne(
      { deletedAt: undefined, state },
      { populate: ['appuserKey', 'bankConnectionKey', 'enableBankingCredentialKey', 'tenantKey'] },
    );
  };

  /**
   * Find the newest linked connection for a given (appuser, tenant) pair.
   * Scoping by tenant prevents cross-tenant access if a user has ever been
   * active in more than one tenant.
   */
  public getNewerLinkedConnection = (appuser: Appuser, tenant: Tenant) => {
    if (!Number.isInteger(tenant.tenantKey) || tenant.tenantKey <= 0) {
      throw new Error('Connection tenant is required and must be a persisted Tenant');
    }
    return this.findOne(
      { appuserKey: appuser, deletedAt: undefined, status: EnableBankingConnectionStatus.LINKED, tenantKey: tenant },
      { orderBy: { createdAt: QueryOrder.DESC } },
    );
  };

  /** The generic row backing this Enable Banking connection, or null before the backfill ran. */
  private bankConnectionOf = async (connection: EnableBankingConnection): Promise<BankConnection | null> => {
    const key = (connection.bankConnectionKey as unknown as undefined | { bankConnectionKey?: number })?.bankConnectionKey;
    if (!key) return null;
    return this.em.findOne(BankConnection, { bankConnectionKey: key });
  };
}
