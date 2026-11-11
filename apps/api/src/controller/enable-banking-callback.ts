import type { Request, Response } from 'express';

import { DI } from '@app/database/di';
import { EnableBankingReturnTo } from '@app/types/enable-banking-return-to';
import { zParse } from '@app/validators/parser';
import { BankConnection } from '@entity/BankConnection';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import accountInitialSyncEnqueueService, { AccountInitialSyncQueueError } from '@service/account/account-initial-sync-enqueue.service';
import { ENABLE_BANKING_PROVIDER_ID, requireBankProvider } from '@service/bank-providers/registry';
import { ENABLE_BANKING_CALLBACK_REDIRECT_URL } from '@utils/constants';
import { sanitizeProviderResponse } from '@utils/error-sanitizer';
import logger from '@utils/logger';
import { enableBankingCallbackRequestSchema } from '@validators/enable-banking-callback';

/**
 * Handles the end user's browser being redirected back here directly by Enable Banking (via
 * their bank) — this is NOT called by WonderMoney's own frontend as an API call, and the browser
 * arriving here has no WonderMoney session necessarily active. Enable Banking's callback carries
 * no WonderMoney auth token either way, so safety here comes entirely from validating `state`
 * server-side against our own DB, not from auth middleware.
 *
 * The provider implementation owns the exchange/link/account-creation work; this controller owns
 * the browser redirect and the best-effort first-sync enqueue.
 */
export async function enableBankingCallback(req: Request, res: Response) {
  const {
    query: { code, error, state },
  } = await zParse(enableBankingCallbackRequestSchema, req);

  if (!state) {
    logger.warn({}, 'Enable Banking callback received without a state value');
    res.redirect(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ status: 'error' }));
    return;
  }

  // Where the browser came from (web or mobile) is stored on the connection, so an error can
  // still send the user back to the surface that started the flow.
  const known = await DI.em.getRepository(EnableBankingConnection).findByState(state).catch(() => null);
  const returnTo = (known?.returnTo ?? null);

  if (error) {
    logger.warn({ error }, 'Enable Banking callback returned a provider error');
    res.redirect(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ returnTo, status: 'error' }));
    return;
  }

  if (!code) {
    logger.warn({}, 'Enable Banking callback missing both code and error');
    res.redirect(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ returnTo, status: 'error' }));
    return;
  }

  let completed: Awaited<ReturnType<ReturnType<typeof requireBankProvider>['completeConnection']>>;
  try {
    completed = await requireBankProvider(ENABLE_BANKING_PROVIDER_ID).completeConnection({ code, state });
  } catch (exchangeError) {
    const providerResponse = sanitizeProviderResponse(exchangeError);
    logger.warn({ providerResponse }, 'Enable Banking session exchange failed');
    res.redirect(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ returnTo, status: 'error' }));
    return;
  }

  // The bank connection itself has already succeeded above (status is `linked` and committed) —
  // everything from here on is "kick off the first sync," which is best-effort with respect to
  // *this redirect*. A failure here must not turn a genuinely-linked bank connection into an
  // `error` redirect.
  try {
    if (completed.postLinkError) {
      const providerResponse = sanitizeProviderResponse(completed.postLinkError);
      logger.warn(
        {
          bankConnectionKey: completed.bankConnectionKey,
          errorMessage: completed.postLinkError instanceof Error ? completed.postLinkError.message : undefined,
          providerResponse,
        },
        'Enable Banking callback linked the connection but account creation or initial-sync enqueue failed',
      );
    } else if (completed.accountsCreated > 0) {
      const connection = await DI.em.findOneOrFail(BankConnection, { bankConnectionKey: completed.bankConnectionKey });
      await accountInitialSyncEnqueueService.enqueue(connection, { enqueue: req.enqueue });
    } else {
      logger.warn({ bankConnectionKey: completed.bankConnectionKey }, 'Enable Banking callback linked but created zero accounts — skipping initial sync enqueue');
    }
  } catch (postLinkError) {
    const providerResponse = sanitizeProviderResponse(postLinkError);
    logger.warn(
      {
        bankConnectionKey: completed.bankConnectionKey,
        errorMessage: postLinkError instanceof Error ? postLinkError.message : undefined,
        providerResponse,
        queueAccepted: postLinkError instanceof AccountInitialSyncQueueError ? postLinkError.queueAccepted : undefined,
      },
      'Enable Banking callback linked the connection but account creation or initial-sync enqueue failed',
    );
  }

  res.redirect(ENABLE_BANKING_CALLBACK_REDIRECT_URL({ returnTo: completed.returnTo === EnableBankingReturnTo.MOBILE ? EnableBankingReturnTo.MOBILE : null, status: 'success' }));
}
