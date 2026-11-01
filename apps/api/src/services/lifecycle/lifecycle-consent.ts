/**
 * The consent gate for generic lifecycle sends.
 *
 * `handleLifecycleSendJob` reached Resend without consulting any consent signal
 * at all — not `deletedAt`, not `recordActive`, not `marketingOptOut`, not the
 * per-category `EmailNotificationPreference` flags. Every campaign's own
 * `isEligible` is `async () => true`, so nothing else covered for it.
 *
 * Measured on production 2026-08-24: 15 of 177 lifecycle sends went to
 * soft-deleted accounts (31% of `reactivation`), 11 of them strictly after the
 * account's `marketing_opt_out` timestamp.
 *
 * The deleted-account half is the visible symptom — those addresses are scrubbed
 * to `deleted+<key>@deleted.invalid` by `account-deletion.service`, so the mail
 * loops back into our own domain rather than reaching the person. The opt-out
 * half is the latent one: `opted_out_but_alive` is currently 0 only because no
 * live user has clicked unsubscribe yet. The first one who does would have kept
 * receiving lifecycle mail.
 *
 * This mirrors the gate `bank-recovery.service.ts` already applies before its
 * own sends (inactive appuser -> opt-out -> category flag), so the two
 * authorized-send paths agree rather than each inventing a policy.
 */

import { canSendOptionalEmail, EmailCategory, type EmailCategoryFlagsSource } from '@service/email/email-preferences';
import { LifecycleCampaign } from '@service/lifecycle/lifecycle-types';

/** The subset of `Appuser` this gate reads. Structural, so a raw-SQL projection also satisfies it. */
export interface LifecycleRecipient {
  deletedAt?: Date | null;
  emailAddress?: null | string;
  marketingOptOut?: Date | null;
  recordActive?: boolean;
}

/** Written to `LifecycleDelivery.outcomeCode`, so these strings are queryable after the fact. */
export type LifecycleConsentBlock = 'marketing_opt_out' | 'recipient_unreachable' | `${string}_disabled`;

/**
 * Which optional-email category a campaign's mail belongs to, or `undefined`
 * when it is transactional and therefore ungated by marketing preferences.
 *
 * The one exemption is deliberate and conservative — exempt means "still
 * sends":
 *
 * - `DATA_HEALTH` is a service interruption notice: bank consent is expiring and
 *   syncing is about to stop. Suppressing it would let someone's data silently
 *   go stale.
 *
 * Everything else is optional mail and is gated.
 */
export function lifecycleEmailCategory(campaign: LifecycleCampaign, _step: string): EmailCategory | undefined {
  switch (campaign) {
    case LifecycleCampaign.DATA_HEALTH:
      return undefined;
    default:
      // A campaign added without a mapping is treated as optional mail rather
      // than transactional, so the failure mode of forgetting this switch is a
      // suppressed email, not an unconsented one.
      return EmailCategory.GROWTH;
  }
}

/**
 * True when the account can receive mail of any kind. Deletion scrubs the
 * address to an internal one and flips `recordActive`, so this is not a consent
 * question — the mailbox is gone. It therefore applies to transactional
 * campaigns too.
 */
export function isRecipientReachable(recipient: LifecycleRecipient | null | undefined): recipient is LifecycleRecipient {
  if (!recipient?.emailAddress) return false;
  if (recipient.deletedAt) return false;
  return recipient.recordActive !== false;
}

/**
 * The reason this send must not go out, or `undefined` to proceed.
 *
 * Order matters: reachability is checked first because it applies to every
 * campaign, transactional included, and because a deleted account has a
 * `marketingOptOut` set as a side effect of deletion — reporting that as
 * `marketing_opt_out` would misattribute the cause in the delivery log.
 */
export function checkLifecycleConsent(
  recipient: LifecycleRecipient | null | undefined,
  prefs: EmailCategoryFlagsSource,
  campaign: LifecycleCampaign,
  step: string,
): LifecycleConsentBlock | undefined {
  if (!isRecipientReachable(recipient)) return 'recipient_unreachable';

  const category = lifecycleEmailCategory(campaign, step);
  if (!category) return undefined;

  if (canSendOptionalEmail(recipient, prefs, category)) return undefined;
  // Distinguish the account-wide unsubscribe from a single category toggle, so
  // the delivery log says which one stopped the send.
  return recipient.marketingOptOut ? 'marketing_opt_out' : `${category.toLowerCase()}_disabled`;
}
