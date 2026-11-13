import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/core';

import type { Appuser } from '@entity/Appuser';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { SimplefinConnection } from '@entity/SimplefinConnection';
import type { Tenant } from '@entity/Tenant';
import { isBankProviderEnabled, SIMPLEFIN_PROVIDER_ID } from '@service/bank-providers/registry';
import { BadGatewayError, BadRequestError, ERROR_CODE, FeatureDisabledError, NotFoundError } from '@utils/errors';

import { claimSetupToken, SimplefinClaimError, type SimplefinClientDeps } from './simplefin-client';
import { assertCredentialStorageAvailable, encryptAccessUrl, wipeAccessUrl } from './simplefin-credential';
import { SimplefinUrlRefusedError } from './simplefin-url-guard';

/**
 * Making and removing a SimpleFIN connection.
 *
 * **Connect.** The user pastes a setup token. It is claimed exactly once: the access URL it
 * returns is encrypted and stored, and the plaintext token and URL go no further than this call.
 * The connection is linked straight away (SimpleFIN has no consent redirect) and its accounts
 * appear with the first sync, which the caller enqueues.
 *
 * **Disconnect.** Soft-deletes the connection and destroys the stored access URL, so nothing can
 * sync it again. The user should also disable the token at their SimpleFIN server.
 *
 * A connection belongs to the member who made it: every lookup is scoped to that member and
 * household, so a partner's or another household's connection is a 404.
 */
export interface ConnectSimplefinInput {
  appuser: Appuser;
  setupToken: string;
  tenant: Tenant;
}

export async function connectSimplefin(em: EntityManager, input: ConnectSimplefinInput, deps: SimplefinClientDeps = {}): Promise<{ bankConnection: BankConnection; connection: SimplefinConnection }> {
  if (!isBankProviderEnabled(SIMPLEFIN_PROVIDER_ID)) throw new FeatureDisabledError('SimpleFIN bank sync');
  // A token works once: refuse before claiming it if the access URL could not be stored.
  try {
    assertCredentialStorageAvailable();
  } catch {
    throw new FeatureDisabledError('SimpleFIN bank sync (credential encryption)');
  }

  let accessUrl: string;
  try {
    accessUrl = await claimSetupToken(input.setupToken, deps);
  } catch (error) {
    throw claimFailure(error);
  }

  const serverHost = new URL(accessUrl).hostname;
  const encrypted = encryptAccessUrl(accessUrl);
  return em.transactional(async (tx) => {
    const bankConnection = tx.create(BankConnection, {
      appuserKey: input.appuser,
      externalId: `simplefin:${randomUUID()}`,
      provider: SIMPLEFIN_PROVIDER_ID,
      status: BankConnectionStatus.LINKED,
      tenantKey: input.tenant,
    }, { partial: true });
    const connection = tx.create(SimplefinConnection, {
      ...encrypted,
      appuserKey: input.appuser,
      bankConnectionKey: bankConnection,
      serverHost,
      tenantKey: input.tenant,
    }, { partial: true });
    await tx.flush();
    return { bankConnection, connection };
  });
}

/** Idempotent: a connection already disconnected by this member answers like a fresh one. */
export async function disconnectSimplefin(em: EntityManager, connectionId: number, appuser: Appuser, tenant: Tenant): Promise<void> {
  const connection = await em.findOne(SimplefinConnection, { appuserKey: appuser, simplefinConnectionKey: connectionId, tenantKey: tenant }, { populate: ['bankConnectionKey'] });
  if (!connection) throw new NotFoundError(`Connection ${connectionId} not found`);
  if (connection.deletedAt && !connection.accessUrlCiphertext) return;
  const now = new Date();
  connection.deletedAt ??= now;
  wipeAccessUrl(connection);
  connection.bankConnectionKey.deletedAt ??= now;
  await em.flush();
}

/** The member's own live SimpleFIN connection, or a 404. */
export async function findOwnedSimplefinConnection(em: EntityManager, connectionId: number, appuser: Appuser, tenant: Tenant): Promise<SimplefinConnection> {
  const connection = await em.findOne(
    SimplefinConnection,
    { appuserKey: appuser, deletedAt: undefined, simplefinConnectionKey: connectionId, tenantKey: tenant },
    { populate: ['bankConnectionKey'] },
  );
  if (!connection) throw new NotFoundError('Bank connection not found');
  return connection;
}

/** Fixed, user-safe messages: never the token, the URL or the server's own text. */
/** Each 400 carries a code (`ERROR_CODE.SIMPLEFIN_*`) so the clients can show it in the user's language. */
function claimFailure(error: unknown): Error {
  if (error instanceof SimplefinUrlRefusedError) {
    const tokenProblem = error.reason === 'bad_token' || error.reason === 'credentials_in_claim_url' || error.reason === 'not_https';
    return new BadRequestError(error.message, tokenProblem ? ERROR_CODE.SIMPLEFIN_TOKEN_INVALID : ERROR_CODE.SIMPLEFIN_SERVER_NOT_ALLOWED);
  }
  if (error instanceof SimplefinClaimError) {
    if (error.reason === 'unavailable') return new BadGatewayError(error.message);
    return new BadRequestError(error.message, error.reason === 'already_claimed' ? ERROR_CODE.SIMPLEFIN_TOKEN_ALREADY_CLAIMED : ERROR_CODE.SIMPLEFIN_SERVER_NOT_ALLOWED);
  }
  return new BadGatewayError('SimpleFIN could not be reached. Try again in a moment.');
}
