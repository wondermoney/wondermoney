import { LockMode, QueryOrder } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { Appuser } from '@entity/Appuser';
import { EnableBankingCredential, EnableBankingCredentialStatus } from '@entity/EnableBankingCredential';
import type { Tenant } from '@entity/Tenant';
import { decryptSecret, encryptSecret } from '@service/crypto/secret-encryption.service';
import { getRef } from '@utils/em-helpers';
import { ConflictError, EnableBankingCredentialInvalidError, ERROR_CODE } from '@utils/errors';

import { generateEnableBankingKeyPair } from './enable-banking-certificate';
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
  /** Null only while the person's sole credential is a pending one, with no application yet. */
  applicationId: null | string;
  lastValidatedAt: null | string;
  lastValidationError: null | string;
  /**
   * A generated key waiting for its application ID, and when it lapses. Beside an active
   * credential it is the replacement being set up; the active one stays in use until then.
   */
  pending: null | { expiresAt: string };
  status: EnableBankingCredentialStatus;
}

/** `POST /v1/user/enable-banking-credential/certificate`: the certificate to upload, and until when it can be activated. */
export interface PendingEnableBankingCertificateDto {
  certificatePem: string;
  expiresAt: string;
}

/** How long a generated key waits for its application ID before it lapses. */
export const PENDING_ENABLE_BANKING_CREDENTIAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

function pendingExpiresAt(credential: EnableBankingCredential): Date {
  return new Date(credential.createdAt.getTime() + PENDING_ENABLE_BANKING_CREDENTIAL_TTL_MS);
}

function toStatusDto(credential: EnableBankingCredential, pending: EnableBankingCredential | null): EnableBankingCredentialStatusDto {
  return {
    applicationId: credential.applicationId ?? null,
    lastValidatedAt: credential.lastValidatedAt?.toISOString() ?? null,
    lastValidationError: credential.lastValidationError ?? null,
    pending: pending ? { expiresAt: pendingExpiresAt(pending).toISOString() } : null,
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
 *
 * Beside it a person may hold one `pending` row: a key pair this server generated, waiting for
 * the application ID Enable Banking assigns to its certificate. A pending row is never the
 * "current" credential (status, link, sync), lapses after
 * `PENDING_ENABLE_BANKING_CREDENTIAL_TTL_MS`, and becomes `active` in place when activated. A
 * connection made with an earlier credential keeps that credential.
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
    // A pending key signs nothing but its own activation check (`decryptPendingForActivation`).
    if (credential.status === EnableBankingCredentialStatus.PENDING || !credential.applicationId) {
      throw new EnableBankingCredentialInvalidError('This Enable Banking key is not activated yet');
    }
    return { applicationId: credential.applicationId, privateKeyPem: decryptPrivateKey(credential) };
  }

  /**
   * The pending key, decrypted, paired with the application ID the person entered, for the signed
   * test call that decides whether it may be activated.
   */
  decryptPendingForActivation(pending: EnableBankingCredential, applicationId: string): DecryptedEnableBankingCredential {
    if (pending.status !== EnableBankingCredentialStatus.PENDING) throw new Error('Not a pending Enable Banking credential');
    return { applicationId, privateKeyPem: decryptPrivateKey(pending) };
  }

  /**
   * Generates a key pair for the person and stores it as their pending credential, private key
   * encrypted. Any pending credential they had is deleted outright: it was never activated, so no
   * connection points at it. Their active credential is not touched. Returns the certificate to
   * upload to Enable Banking; the private key is never returned.
   */
  async createPendingCredential({ appuser, tenant }: { appuser: Appuser; tenant?: Tenant }): Promise<PendingEnableBankingCertificateDto> {
    const { certificatePem, privateKeyPem } = await generateEnableBankingKeyPair();
    const encrypted = encryptSecret(privateKeyPem);

    const credential = new EnableBankingCredential();
    credential.appuserKey = appuser;
    credential.applicationId = null;
    credential.privateKeyCiphertext = encrypted.ciphertext;
    credential.privateKeyIv = encrypted.iv;
    credential.privateKeyAuthTag = encrypted.authTag;
    credential.encryptionKeyVersion = encrypted.keyVersion;
    credential.status = EnableBankingCredentialStatus.PENDING;
    if (tenant) credential.tenantKey = tenant;

    await this.em.transactional(async (tx) => {
      await lockAppuser(tx, appuser.appuserKey);
      await tx.nativeDelete(EnableBankingCredential, { appuserKey: getRef(tx, Appuser, appuser.appuserKey), status: EnableBankingCredentialStatus.PENDING });
      tx.persist(credential);
    });
    return { certificatePem, expiresAt: pendingExpiresAt(credential).toISOString() };
  }

  /**
   * Turns a pending credential that passed the signed test call into the person's active one, under
   * the application ID Enable Banking gave its certificate, and retires their earlier credential
   * (see {@link retireCurrentRows}). The update is conditional on the row still being pending: a
   * certificate created meanwhile replaced it, and then nothing is activated (409).
   */
  async activatePendingCredential(pending: EnableBankingCredential, applicationId: string, now: Date = new Date()): Promise<EnableBankingCredentialStatusDto> {
    const appuserKey = pending.appuserKey.appuserKey;
    await this.em.transactional(async (tx) => {
      await lockAppuser(tx, appuserKey);
      const activated = await tx.nativeUpdate(
        EnableBankingCredential,
        { deletedAt: null, enableBankingCredentialKey: pending.enableBankingCredentialKey, status: EnableBankingCredentialStatus.PENDING },
        { applicationId, lastValidatedAt: now, lastValidationError: null, status: EnableBankingCredentialStatus.ACTIVE, updatedAt: now },
      );
      if (activated !== 1) throw pendingCredentialMissing();
      await retireCurrentRows(tx, appuserKey, now, pending.enableBankingCredentialKey);
    });
    const activated = await this.em.fork().findOneOrFail(EnableBankingCredential, { enableBankingCredentialKey: pending.enableBankingCredentialKey });
    return toStatusDto(activated, null);
  }

  /**
   * Deletes every pending credential older than its seven days, in every household (the worker
   * has no tenant context). They were never activated, so no connection points at them. Returns
   * how many went.
   */
  purgeLapsedPendingCredentials(now: Date = new Date()): Promise<number> {
    return this.em.nativeDelete(EnableBankingCredential, {
      createdAt: { $lte: new Date(now.getTime() - PENDING_ENABLE_BANKING_CREDENTIAL_TTL_MS) },
      status: EnableBankingCredentialStatus.PENDING,
    });
  }

  /** The person's pending credential, unless it has lapsed. */
  getLivePendingCredential(appuserKey: number, now: Date = new Date()): Promise<EnableBankingCredential | null> {
    return this.em.findOne(
      EnableBankingCredential,
      {
        appuserKey: getRef(this.em, Appuser, appuserKey),
        createdAt: { $gt: new Date(now.getTime() - PENDING_ENABLE_BANKING_CREDENTIAL_TTL_MS) },
        deletedAt: undefined,
        status: EnableBankingCredentialStatus.PENDING,
      },
      { orderBy: { createdAt: QueryOrder.DESC } },
    );
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

  /**
   * Removes the person's credential: every credential they have is soft-deleted (connections made
   * with one still point at its row, and keep syncing with it), and a pending one is deleted
   * outright. Idempotent.
   */
  async deleteForAppuser(appuserKey: number): Promise<void> {
    await this.em.transactional(async (tx) => {
      await lockAppuser(tx, appuserKey);
      await tx.nativeDelete(EnableBankingCredential, { appuserKey: getRef(tx, Appuser, appuserKey), status: EnableBankingCredentialStatus.PENDING });
      await retireCurrentRows(tx, appuserKey, new Date());
    });
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

  /**
   * Current credential's status, for the Settings UI, with the pending one beside it. A pending
   * credential alone reads as `pending`. `null` when the user has neither.
   */
  async getStatusForAppuser(appuserKey: number, now: Date = new Date()): Promise<EnableBankingCredentialStatusDto | null> {
    const credential = await this.findCurrentRow(appuserKey);
    const pending = await this.getLivePendingCredential(appuserKey, now);
    if (credential) return toStatusDto(credential, pending);
    return pending ? toStatusDto(pending, pending) : null;
  }

  /**
   * Persists a credential that has already been proven to work against Enable
   * Banking (the controller validates it live before calling this — this
   * method never talks to the provider itself). It is a new row: the person's earlier credential
   * is retired, not overwritten (see {@link retireCurrentRows}), so the connections made with it
   * keep the application their sessions belong to. A generated key still waiting for its
   * application ID is deleted.
   */
  async saveValidatedCredential({ applicationId, appuser, privateKeyPem, tenant }: SaveValidatedEnableBankingCredentialParams): Promise<EnableBankingCredentialStatusDto> {
    const encrypted = encryptSecret(privateKeyPem);
    const now = new Date();

    const credential = new EnableBankingCredential();
    credential.appuserKey = appuser;
    credential.applicationId = applicationId;
    credential.privateKeyCiphertext = encrypted.ciphertext;
    credential.privateKeyIv = encrypted.iv;
    credential.privateKeyAuthTag = encrypted.authTag;
    credential.encryptionKeyVersion = encrypted.keyVersion;
    credential.status = EnableBankingCredentialStatus.ACTIVE;
    credential.lastValidatedAt = now;
    if (tenant) credential.tenantKey = tenant;

    await this.em.transactional(async (tx) => {
      await lockAppuser(tx, appuser.appuserKey);
      await retireCurrentRows(tx, appuser.appuserKey, now);
      await tx.nativeDelete(EnableBankingCredential, { appuserKey: getRef(tx, Appuser, appuser.appuserKey), status: EnableBankingCredentialStatus.PENDING });
      tx.persist(credential);
    });
    return toStatusDto(credential, null);
  }

  private findActiveCredential(appuserKey: number): Promise<EnableBankingCredential | null> {
    return this.em.findOne(
      EnableBankingCredential,
      { appuserKey: getRef(this.em, Appuser, appuserKey), deletedAt: undefined, status: EnableBankingCredentialStatus.ACTIVE },
      { orderBy: { createdAt: QueryOrder.DESC } },
    );
  }

  /** The latest credential that is not pending: active, invalid or revoked. */
  private findCurrentRow(appuserKey: number): Promise<EnableBankingCredential | null> {
    return this.em.findOne(
      EnableBankingCredential,
      { appuserKey: getRef(this.em, Appuser, appuserKey), deletedAt: undefined, status: { $ne: EnableBankingCredentialStatus.PENDING } },
      { orderBy: { createdAt: QueryOrder.DESC } },
    );
  }
}

function decryptPrivateKey(credential: EnableBankingCredential): string {
  return decryptSecret({
    authTag: credential.privateKeyAuthTag,
    ciphertext: credential.privateKeyCiphertext,
    iv: credential.privateKeyIv,
    keyVersion: credential.encryptionKeyVersion,
  });
}

/**
 * Every write to a person's credentials (create, activate, paste, remove) first locks their
 * `appuser` row, so two of them run one after the other. Without it a paste and an activation
 * could interleave: the paste retires the rows it sees and inserts its own while the activation
 * turns a still-uncommitted pending row active, leaving two active credentials.
 */
async function lockAppuser(em: EntityManager, appuserKey: number): Promise<void> {
  await em.findOneOrFail(Appuser, { appuserKey }, { fields: ['appuserKey'], lockMode: LockMode.PESSIMISTIC_WRITE });
}

function pendingCredentialMissing(): ConflictError {
  return new ConflictError('There is no Enable Banking key waiting to be activated. Create a new certificate and register it again.', ERROR_CODE.ENABLE_BANKING_PENDING_CREDENTIAL_MISSING);
}

/**
 * Soft-deletes every credential of the person that is not pending (`except` aside). A retired row
 * is never the current credential again, for status, new links or removal, but a connection made
 * with it still points at it and signs with it: an Enable Banking session belongs to the
 * application that created it (`decryptForConnection` ignores `deletedAt`).
 */
async function retireCurrentRows(em: EntityManager, appuserKey: number, now: Date, except?: number): Promise<void> {
  await em.nativeUpdate(
    EnableBankingCredential,
    {
      appuserKey: getRef(em, Appuser, appuserKey),
      deletedAt: null,
      status: { $ne: EnableBankingCredentialStatus.PENDING },
      ...(except === undefined ? {} : { enableBankingCredentialKey: { $ne: except } }),
    },
    { deletedAt: now, updatedAt: now },
  );
}

export const enableBankingCredentialService = new EnableBankingCredentialService();
