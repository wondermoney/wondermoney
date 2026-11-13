import { QueryOrder } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { Appuser } from '@entity/Appuser';
import { EnableBankingCredential, EnableBankingCredentialStatus } from '@entity/EnableBankingCredential';
import type { Tenant } from '@entity/Tenant';
import { decryptSecret, encryptSecret } from '@service/crypto/secret-encryption.service';
import { getRef } from '@utils/em-helpers';

import { instanceEnableBankingCredential } from './instance-credential';
import { mayUseInstanceEnableBankingCredential } from './instance-credential-policy';

export interface DecryptedEnableBankingCredential {
  applicationId: string;
  privateKeyPem: string;
}

/**
 * The credential a new link uses: the user's own (`entity` is the row the connection will point
 * at), or the instance-wide one (`entity` null).
 */
export interface EnableBankingCredentialStatusDto {
  applicationId: string;
  lastValidatedAt: null | string;
  lastValidationError: null | string;
  status: EnableBankingCredentialStatus;
}

export type ResolvedEnableBankingCredential =
  | { credential: DecryptedEnableBankingCredential; entity: EnableBankingCredential; source: 'user' }
  | { credential: DecryptedEnableBankingCredential; entity: null; source: 'instance' };

export interface SaveValidatedEnableBankingCredentialParams {
  applicationId: string;
  appuser: Appuser;
  privateKeyPem: string;
  tenant?: Tenant;
}

/** A connection made with the instance credential after the operator removed it. */
export class InstanceEnableBankingCredentialUnavailableError extends Error {
  constructor() {
    super('This bank connection was made with the server\'s Enable Banking credential, which is no longer configured');
    this.name = 'InstanceEnableBankingCredentialUnavailableError';
  }
}

function toStatusDto(credential: EnableBankingCredential): EnableBankingCredentialStatusDto {
  return {
    applicationId: credential.applicationId,
    lastValidatedAt: credential.lastValidatedAt?.toISOString() ?? null,
    lastValidationError: credential.lastValidationError ?? null,
    status: credential.status,
  };
}

/**
 * Owns reads/writes of the user's own Enable Banking BYOK application
 * registration (`EnableBankingCredential`). Per the entity's docblock this is
 * "one active row per user" resolved at the application level (latest
 * `createdAt`, no DB unique constraint). Key material
 * only ever leaves this service decrypted, in-process, for the caller's
 * immediate use (e.g. signing a JWT) — never persisted or logged plaintext.
 */
export class EnableBankingCredentialService {
  private get em(): EntityManager {
    return this.injectedEm ?? DI.em;
  }

  constructor(private readonly injectedEm?: EntityManager) {}

  /**
   * Decrypts an already-loaded credential entity in place, without a DB round-trip.
   * Used by callers that already hold the *specific* credential row a flow was
   * started with (e.g. the Enable Banking callback resolving `EnableBankingConnection
   * .enableBankingCredentialKey`) — re-resolving "the user's current active credential"
   * there would be wrong if the user replaced their key mid-flow.
   */
  decryptCredentialEntity(credential: EnableBankingCredential): DecryptedEnableBankingCredential {
    const privateKeyPem = decryptSecret({
      authTag: credential.privateKeyAuthTag,
      ciphertext: credential.privateKeyCiphertext,
      iv: credential.privateKeyIv,
      keyVersion: credential.encryptionKeyVersion,
    });

    return { applicationId: credential.applicationId, privateKeyPem };
  }

  /**
   * The credential a stored connection was made with: its own credential row, or the instance
   * credential when it has none. A connection never switches credential: an Enable Banking
   * session belongs to the application that created it.
   */
  decryptForConnection(connection: { enableBankingCredentialKey?: EnableBankingCredential | null }): DecryptedEnableBankingCredential {
    if (connection.enableBankingCredentialKey) return this.decryptCredentialEntity(connection.enableBankingCredentialKey);
    const instance = instanceEnableBankingCredential();
    if (!instance) throw new InstanceEnableBankingCredentialUnavailableError();
    return instance;
  }

  async deleteForAppuser(appuserKey: number): Promise<void> {
    const credential = await this.findCurrentRow(appuserKey);
    if (!credential || credential.deletedAt) {
      // Idempotent: no credential (or already deleted) is already the desired end state.
      return;
    }
    credential.deletedAt = new Date();
    await this.em.persist(credential).flush();
  }

  /**
   * The user's current active credential entity (FK target), without decrypting key
   * material. Used when a new row needs to reference "the credential in effect right
   * now" (e.g. `startBankConnection` persisting a new `EnableBankingConnection`).
   */
  async getActiveCredentialEntity(appuserKey: number): Promise<EnableBankingCredential | null> {
    return this.findActiveCredential(appuserKey);
  }

  /** Decrypted credential for provider calls (e.g. the sync). Only ever returns an `active` credential. */
  async getDecryptedCredential(appuserKey: number): Promise<DecryptedEnableBankingCredential | null> {
    const credential = await this.findActiveCredential(appuserKey);
    if (!credential) return null;
    return this.decryptCredentialEntity(credential);
  }

  /**
   * The credential a new link by this user in this household uses. Their own active credential
   * always wins; without one, the instance credential when `instance-credential-policy.ts` lets
   * this household use it; otherwise null. Without a household (`tenantKey` undefined) only the
   * user's own credential counts.
   */
  async resolveForNewLink(appuserKey: number, tenantKey: number | undefined): Promise<null | ResolvedEnableBankingCredential> {
    const own = await this.findActiveCredential(appuserKey);
    if (own) return { credential: this.decryptCredentialEntity(own), entity: own, source: 'user' };
    if (tenantKey === undefined || !(await mayUseInstanceEnableBankingCredential(this.em, tenantKey))) return null;
    const instance = instanceEnableBankingCredential();
    return instance ? { credential: instance, entity: null, source: 'instance' } : null;
  }

  /** Current credential's status, for the Settings UI. `null` when the user has never registered one. */
  async getStatusForAppuser(appuserKey: number): Promise<EnableBankingCredentialStatusDto | null> {
    const credential = await this.findCurrentRow(appuserKey);
    return credential ? toStatusDto(credential) : null;
  }

  /**
   * Persists a credential that has already been proven to work against Enable
   * Banking (the controller validates it live before calling this — this
   * method never talks to the provider itself). Updates the user's current row
   * in place when one exists, rather than stacking a new row per save, per the
   * entity's "one active row per user" contract.
   */
  async saveValidatedCredential({ applicationId, appuser, privateKeyPem, tenant }: SaveValidatedEnableBankingCredentialParams): Promise<EnableBankingCredentialStatusDto> {
    const encrypted = encryptSecret(privateKeyPem);
    const now = new Date();

    let credential = await this.findCurrentRow(appuser.appuserKey);
    if (!credential) {
      credential = new EnableBankingCredential();
      credential.appuserKey = appuser;
    }

    credential.applicationId = applicationId;
    credential.privateKeyCiphertext = encrypted.ciphertext;
    credential.privateKeyIv = encrypted.iv;
    credential.privateKeyAuthTag = encrypted.authTag;
    credential.encryptionKeyVersion = encrypted.keyVersion;
    credential.status = EnableBankingCredentialStatus.ACTIVE;
    credential.lastValidatedAt = now;
    credential.lastValidationError = undefined;
    credential.deletedAt = undefined;
    if (tenant) credential.tenantKey = tenant;

    await this.em.persist(credential).flush();
    return toStatusDto(credential);
  }

  private findActiveCredential(appuserKey: number): Promise<EnableBankingCredential | null> {
    return this.em.findOne(
      EnableBankingCredential,
      { appuserKey: getRef(this.em, Appuser, appuserKey), deletedAt: undefined, status: EnableBankingCredentialStatus.ACTIVE },
      { orderBy: { createdAt: QueryOrder.DESC } },
    );
  }

  private findCurrentRow(appuserKey: number): Promise<EnableBankingCredential | null> {
    return this.em.findOne(
      EnableBankingCredential,
      { appuserKey: getRef(this.em, Appuser, appuserKey), deletedAt: undefined },
      { orderBy: { createdAt: QueryOrder.DESC } },
    );
  }
}

export const enableBankingCredentialService = new EnableBankingCredentialService();
