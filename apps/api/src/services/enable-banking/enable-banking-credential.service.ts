import { QueryOrder } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { Appuser } from '@entity/Appuser';
import { EnableBankingCredential, EnableBankingCredentialStatus } from '@entity/EnableBankingCredential';
import type { Tenant } from '@entity/Tenant';
import { decryptSecret, encryptSecret } from '@service/crypto/secret-encryption.service';
import { getRef } from '@utils/em-helpers';

export interface DecryptedEnableBankingCredential {
  applicationId: string;
  privateKeyPem: string;
}

export interface EnableBankingCredentialStatusDto {
  applicationId: string;
  lastValidatedAt: null | string;
  lastValidationError: null | string;
  status: EnableBankingCredentialStatus;
}

export interface SaveValidatedEnableBankingCredentialParams {
  applicationId: string;
  appuser: Appuser;
  privateKeyPem: string;
  tenant?: Tenant;
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
