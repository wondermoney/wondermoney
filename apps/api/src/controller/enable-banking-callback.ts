import type { Request, Response } from 'express';

import { zParse } from '@app/validators/parser';
import { BANK_SYNC_PROVIDER_DISABLED } from '@config/env';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import accountInitialSyncEnqueueService, { AccountInitialSyncQueueError } from '@service/account/account-initial-sync-enqueue.service';
import { createEnableBankingClient } from '@service/enable-banking/enable-banking-client.service';
import { enableBankingCredentialService } from '@service/enable-banking/enable-banking-credential.service';
import { createInitialEnableBankingAccounts } from '@service/enable-banking/enable-banking-initial-accounts.service';
import { ENABLE_BANKING_CALLBACK_REDIRECT_URL } from '@utils/constants';
import { sanitizeProviderResponse } from '@utils/error-sanitizer';
import logger from '@utils/logger';
import { enableBankingCallbackRequestSchema } from '@validators/enable-banking-callback';

import { DI } from '../app';

/**
 * Handles the end user's browser being redirected back here directly by Enable
 * Banking (via their bank) — this is NOT called by WonderMoney's own frontend as an
 * API call, and the browser arriving here has no WonderMoney session necessarily
 * active. Enable Banking's callback carries no WonderMoney auth token either way, so
 * safety here comes entirely from validating `state` server-side against our own DB
 * (the correlation value `startBankConnection` generated and persisted), not from
 * auth middleware — see the route registration in `app.ts` for why this is mounted
 * unauthenticated, mirroring the existing GoCardless `bankConnectionCallback`.
 *
 * Always ends in an HTTP redirect to a fixed, hardcoded/env-derived WonderMoney URL
 * (`ENABLE_BANKING_CALLBACK_REDIRECT_URL`) — never a JSON response, and never a
 * redirect target built from any part of the incoming request. `code`/`state`/`error`
 * are only ever used to look up and mutate our own `EnableBankingConnection` row.
 */
export async function enableBankingCallback(req: Request, res: Response) {
  // Belt-and-braces alongside `getBankList`/`startBankConnection`'s own gate: while
  // `startBankConnection` is disabled no `EnableBankingConnection` row can exist for
  // `findByState` to match anyway, but checking here too means the flag closes this
  // whole surface outright, with no dependency on that indirect argument staying true.
  // Never a thrown error here (this route only ever redirects, never returns JSON).
  if (BANK_SYNC_PROVIDER_DISABLED) {
    logger.warn({}, 'Enable Banking callback reached while bank connections are disabled');
    res.redirect(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
    return;
  }

  const {
    query: { code, error, state },
  } = await zParse(enableBankingCallbackRequestSchema, req);

  if (!state) {
    logger.warn({}, 'Enable Banking callback received without a state value');
    res.redirect(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
    return;
  }

  const connectionRepository = DI.em.getRepository(EnableBankingConnection);
  const connection = await connectionRepository.findByState(state);
  if (!connection) {
    // Unknown, expired, or already-consumed state — never a raw 404/500 to the
    // end user's browser, just the generic error destination.
    logger.warn({}, 'Enable Banking callback state did not match any connection');
    res.redirect(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
    return;
  }

  if (error) {
    await connectionRepository.changeToError(connection);
    logger.warn(
      { enableBankingConnectionKey: connection.enableBankingConnectionKey, error },
      'Enable Banking callback returned a provider error',
    );
    res.redirect(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
    return;
  }

  if (!code) {
    await connectionRepository.changeToError(connection);
    logger.warn(
      { enableBankingConnectionKey: connection.enableBankingConnectionKey },
      'Enable Banking callback missing both code and error',
    );
    res.redirect(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
    return;
  }

  let sessionAccounts: unknown[];
  try {
    // Decrypt the *specific* credential this connection was started with — not
    // necessarily the user's current "active" one, which could have changed since
    // `startBankConnection` ran (see `decryptCredentialEntity`'s docblock).
    const credential = enableBankingCredentialService.decryptCredentialEntity(connection.enableBankingCredentialKey);
    const client = createEnableBankingClient(credential);
    const session = await client.exchangeSession(code);
    sessionAccounts = session.accounts;

    // Real, provider-returned values only — never recomputed/hardcoded (plan §2/§3).
    // `maxConsentValiditySeconds` is carried forward from the real per-bank
    // `GET /aspsps` lookup `startBankConnection` already made; Enable Banking's
    // session-exchange response doesn't repeat it.
    await connectionRepository.changeToLinked(
      connection,
      session.sessionId,
      new Date(session.access.validUntil),
      connection.maxConsentValiditySeconds,
    );
  } catch (exchangeError) {
    await connectionRepository.changeToError(connection);
    const providerResponse = sanitizeProviderResponse(exchangeError);
    logger.warn(
      { enableBankingConnectionKey: connection.enableBankingConnectionKey, providerResponse },
      'Enable Banking session exchange failed',
    );
    res.redirect(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
    return;
  }

  // Phase 1d: the bank connection itself has already succeeded above (status is `linked` and
  // committed) — everything from here on is "kick off the first sync," which is best-effort with
  // respect to *this redirect*. A failure here must not turn a genuinely-linked bank connection
  // into an `error` redirect: the user's consent is real and WonderMoney's own polling/enqueue
  // machinery can be retried independently of the provider round-trip that just succeeded. This
  // mirrors `sendBankConnectedConfirmation` in the GoCardless `bankConnectionCallback` being
  // best-effort/non-blocking, but goes one step further since GoCardless's equivalent enqueue
  // failure *does* still change the redirect (it has a `sync` query param the frontend polls;
  // Enable Banking's redirect helper doesn't carry one yet, see `ENABLE_BANKING_CALLBACK_REDIRECT_URL`).
  try {
    const accountResult = await createInitialEnableBankingAccounts(DI.em, connection, sessionAccounts);
    if (accountResult.accountsCreated > 0) {
      await accountInitialSyncEnqueueService.enqueue(connection, { enqueue: req.enqueue });
    } else {
      logger.warn(
        { enableBankingConnectionKey: connection.enableBankingConnectionKey, skippedReasons: accountResult.skippedReasons },
        'Enable Banking callback linked but created zero accounts — skipping initial sync enqueue',
      );
    }
  } catch (postLinkError) {
    const providerResponse = sanitizeProviderResponse(postLinkError);
    logger.warn(
      {
        enableBankingConnectionKey: connection.enableBankingConnectionKey,
        errorMessage: postLinkError instanceof Error ? postLinkError.message : undefined,
        providerResponse,
        queueAccepted: postLinkError instanceof AccountInitialSyncQueueError ? postLinkError.queueAccepted : undefined,
      },
      'Enable Banking callback linked the connection but account creation or initial-sync enqueue failed',
    );
  }

  res.redirect(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'success' }));
}
