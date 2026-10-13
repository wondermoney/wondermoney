import '@service/lifecycle/campaigns';

import type { FilterQuery } from '@mikro-orm/core';
import { renderLifecycleEmail } from '@wondermoney/react-email';

import { DI } from '@app/database/di';
import { parseLifecycleSendPayload } from '@app/jobs/lifecycle-send.queue';
import { Appuser, SupportedLanguages } from '@entity/Appuser';
import { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import { LifecycleDelivery } from '@entity/LifecycleDelivery';
import { sendRenderedEmail } from '@service/email/email';
import { EmailGlobalOptOutService } from '@service/email/email-global-opt-out.service';
import { isSendAllowed, loadSendWindow } from '@service/lifecycle/frequency-cap.service';
import { checkLifecycleConsent } from '@service/lifecycle/lifecycle-consent';
import { claimPendingDelivery, LifecycleProviderError, markSent, markSuppressed, resolveProviderFailure } from '@service/lifecycle/lifecycle-delivery.service';
import { getCampaign } from '@service/lifecycle/lifecycle-registry';
import { LifecycleDeliveryStatus } from '@service/lifecycle/lifecycle-types';
import { BACKEND_URL, FRONTEND_URL } from '@utils/constants';
import logger from '@utils/logger';


/**
 * Tags an in-email link so a click is attributable in PostHog.
 *
 * Without this, every lifecycle click arrives as organic traffic. The web
 * pageview capture forwards `searchParams` into `$current_url`, and `utm_*` is
 * not in its drop-list, so these survive to PostHog. `utm_content` carries the
 * step, so steps of the same campaign can be told apart.
 */
function withCampaignTracking(url: string, campaign: string, step: string): string {
  const separator = url.includes('?') ? '&' : '?';
  const params = new URLSearchParams({
    utm_campaign: campaign,
    utm_content: step,
    utm_medium: 'email',
    utm_source: 'lifecycle',
  });
  return `${url}${separator}${params.toString()}`;
}

/**
 * Generic lifecycle send: looks the campaign up in the registry, re-checks
 * eligibility + the frequency/suppression gate at send time, then renders the
 * campaign's copy through the shared nudge shell and sends via Resend.
 */
export async function handleLifecycleSendJob(job: { data: unknown; id?: string }): Promise<void> {
  const payload = parseLifecycleSendPayload(job.data);
  // A job queued for a campaign that no longer exists (activation, engagement and
  // reactivation were removed) is dropped here.
  const def = getCampaign(payload.campaign);
  if (!def) return;

  const delivery = await DI.em.findOne(LifecycleDelivery, { appuserKey: payload.appuserKey, campaign: payload.campaign, step: payload.step } as FilterQuery<LifecycleDelivery>);
  if (delivery?.status !== LifecycleDeliveryStatus.PENDING) return;

  const record = async (outcome: 'sent' | 'suppressed', reason?: string) => {
    logger.info({ campaign: payload.campaign, outcome, reason, step: payload.step }, 'lifecycle email outcome');
  };

  // RAD-593: consent before anything else. This path used to reach Resend
  // without reading deletedAt, recordActive, marketingOptOut or the per-category
  // preference flags — 15 of 177 production sends went to soft-deleted accounts.
  // Loaded here rather than further down because there is no point costing a
  // frequency-window query for someone we must not mail.
  const appuser = await DI.em.findOne(Appuser, { appuserKey: payload.appuserKey });
  const prefs = await DI.em.findOne(EmailNotificationPreference, { appuserKey: payload.appuserKey, deletedAt: null } as FilterQuery<EmailNotificationPreference>);
  const blocked = checkLifecycleConsent(appuser, prefs, payload.campaign, payload.step);
  if (blocked) {
    markSuppressed(delivery, blocked);
    await DI.em.persist(delivery).flush();
    await record('suppressed', blocked);
    return;
  }

  if (!(await def.isEligible(DI.em, payload.appuserKey, payload.step))) {
    markSuppressed(delivery, 'not_eligible');
    await DI.em.persist(delivery).flush();
    await record('suppressed', 'not_eligible');
    return;
  }

  const gate = isSendAllowed(await loadSendWindow(DI.em, payload.appuserKey, new Date()));
  if (!gate.allowed) {
    markSuppressed(delivery, gate.reason ?? 'capped');
    await DI.em.persist(delivery).flush();
    await record('suppressed', gate.reason);
    return;
  }

  // Invariant, not a live branch: `checkLifecycleConsent` already returned
  // `recipient_unreachable` for a missing user or a missing address. Kept so the
  // narrowing below is enforced rather than asserted away with a cast.
  if (!appuser?.emailAddress) throw new Error('Lifecycle recipient unavailable');
  const language: 'EN' | 'PT' = appuser.language === SupportedLanguages.PT ? 'PT' : 'EN';
  const lang = language === 'PT' ? 'pt' : 'en';
  const firstName = appuser.firstName ?? '';
  const appUrl = `${FRONTEND_URL}/${lang}`;
  const unsubscribeUrl = `${BACKEND_URL}/v1/marketing/email-opt-out?token=${encodeURIComponent(new EmailGlobalOptOutService().generateToken(payload.appuserKey))}`;

  // Every gate above suppresses without contacting Resend, so the claim is taken here —
  // as late as possible, but strictly before anything can leave the process.
  //
  // Without it this path was read-status → send → write-status with no lock and no
  // conditional update: a crash (or an ambiguous-outcome throw) between Resend accepting
  // the mail and the status write committing left the row PENDING, and pg-boss's retry
  // sent the same email to the same person a second time.
  if (!(await claimPendingDelivery(DI.em, delivery.lifecycleDeliveryKey, job.id ?? `lifecycle:${payload.campaign}:${payload.appuserKey}:${payload.step}`))) {
    logger.info({ campaign: payload.campaign, step: payload.step }, 'lifecycle delivery not claimable; skipping send');
    return;
  }
  // The claim commits in a forked EM; refresh so a later release/mark writes a complete,
  // constraint-satisfying UPDATE rather than one built from a stale baseline.
  await DI.em.refresh(delivery);

  /**
   * Renders and sends, returning the provider message id. Render failures are raised as
   * `local` (nothing left the process, so a retry is safe); provider failures carry the
   * classification that decides whether the claim is released or resolved terminally.
   */
  const renderAndSend = async (): Promise<string> => {
    let payloadToSend;
    try {
      const data = await def.buildData?.(DI.em, appuser, payload.step, language);
      const rendered = await renderLifecycleEmail({
        campaign: payload.campaign,
        ctaUrl: withCampaignTracking(appUrl, payload.campaign, payload.step),
        data,
        firstName: firstName || undefined,
        language: lang,
        step: payload.step,
        unsubscribeUrl,
      });
      payloadToSend = {
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
        html: rendered.html,
        preheader: rendered.preheader,
        subject: rendered.subject,
        text: rendered.text,
        to: { email: appuser.emailAddress, name: firstName || undefined },
        ...(def.replyTo ? { replyTo: { email: def.replyTo } } : {}),
      };
    } catch {
      throw new LifecycleProviderError('local', 'render_failed');
    }

    const outcome = await sendRenderedEmail(payloadToSend);
    if (outcome.type === 'accepted') return outcome.providerMessageIds[0] ?? 'accepted';
    if (outcome.type === 'intercepted') return 'intercepted';
    // `rejected` means Resend answered with an error status, so nothing was delivered —
    // a retryable one (429 / 5xx) may safely be retried. `unknown` (a null status code)
    // is the genuinely ambiguous case and must never be retried.
    if (outcome.type === 'rejected') throw new LifecycleProviderError(outcome.retryable ? 'local' : 'rejected', outcome.errorCode ?? 'provider_rejected');
    throw new LifecycleProviderError('unknown', 'provider_unknown');
  };

  let messageId: string;
  try {
    messageId = await renderAndSend();
  } catch (error) {
    const { shouldRetry } = resolveProviderFailure(delivery, error);
    await DI.em.persist(delivery).flush();
    await record('suppressed', delivery.outcomeCode);
    // Only rethrow when the claim was released — i.e. when a pg-boss retry can
    // legitimately send. Rethrowing on a terminal outcome would burn retries on a row
    // that immediately no-ops, and (before the claim) was the mechanism that delivered
    // the same email twice.
    if (shouldRetry) throw error;
    return;
  }

  markSent(delivery, messageId, language === 'PT' ? SupportedLanguages.PT : SupportedLanguages.EN);
  await DI.em.persist(delivery).flush();
  await record('sent');
}
