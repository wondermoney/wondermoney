import { QueryOrder } from '@mikro-orm/core';

import { Appuser } from '../entity/Appuser';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '../entity/EnableBankingConnection';
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
    await this.persist(connection).flush();
    return connection;
  };

  /**
   * Dual-write the resolved tenant alongside the owner when creating a new
   * connection: the tenant is sourced from the active tenant context
   * (`req.tenant`), never from a membership lookup, so household
   * account-sharing keeps working even though the *credential* itself is
   * personal (BYOK, one Enable Banking application per user).
   */
  public createConnection = async (
    appuser: Appuser,
    tenant: Tenant,
    credential: EnableBankingCredential,
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
      { populate: ['appuserKey', 'enableBankingCredentialKey', 'tenantKey'] },
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
}
