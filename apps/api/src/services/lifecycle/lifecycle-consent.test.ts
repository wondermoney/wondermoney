import { describe, expect, it } from 'vitest';

import { EmailCategory } from '@service/email/email-preferences';
import { LifecycleCampaign } from '@service/lifecycle/lifecycle-types';

import { checkLifecycleConsent, isRecipientReachable, lifecycleEmailCategory } from './lifecycle-consent';

/**
 * The regression this locks: a lifecycle send that consults no consent signal.
 * The production shape was a soft-deleted account — address scrubbed to
 * `deleted+<key>@deleted.invalid`, `marketing_opt_out` set by the deletion itself —
 * still receiving reactivation mail.
 */

const LIVE = { deletedAt: null, emailAddress: 'a@b.com', marketingOptOut: null, recordActive: true };
const DELETED = { deletedAt: new Date('2026-07-20'), emailAddress: 'deleted+215@deleted.invalid', marketingOptOut: new Date('2026-07-20'), recordActive: false };

describe('isRecipientReachable', () => {
  it('accepts a live account', () => {
    expect(isRecipientReachable(LIVE)).toBe(true);
  });

  it('rejects a soft-deleted account', () => {
    expect(isRecipientReachable(DELETED)).toBe(false);
  });

  it('rejects a deactivated account even when the address survives', () => {
    expect(isRecipientReachable({ ...LIVE, recordActive: false })).toBe(false);
  });

  it('rejects a missing user and a missing address', () => {
    expect(isRecipientReachable(null)).toBe(false);
    expect(isRecipientReachable(undefined)).toBe(false);
    expect(isRecipientReachable({ ...LIVE, emailAddress: null })).toBe(false);
  });

  it('treats an absent recordActive as active, so a partial projection is not silently muted', () => {
    expect(isRecipientReachable({ emailAddress: 'a@b.com' })).toBe(true);
  });
});

describe('lifecycleEmailCategory', () => {
  it('leaves a service-interruption notice ungated', () => {
    expect(lifecycleEmailCategory(LifecycleCampaign.DATA_HEALTH, 'consent_expiring')).toBeUndefined();
  });

  it('fails toward suppression for an unmapped campaign', () => {
    expect(lifecycleEmailCategory('something_new' as unknown as LifecycleCampaign, 'x')).toBe(EmailCategory.GROWTH);
  });
});

describe('checkLifecycleConsent', () => {
  it('blocks the production case: reactivation mail to a deleted account', () => {
    expect(checkLifecycleConsent(DELETED, null, LifecycleCampaign.REACTIVATION, 'whats_new')).toBe('recipient_unreachable');
  });

  it('blames unreachability, not opt-out, when deletion set both', () => {
    // Deletion sets marketingOptOut as a side effect. Reporting that as the
    // cause would send someone debugging the delivery log to the wrong place.
    expect(checkLifecycleConsent(DELETED, null, LifecycleCampaign.REACTIVATION, 'whats_new')).not.toBe('marketing_opt_out');
  });

  it('blocks a deleted account even for transactional mail, because the mailbox is gone', () => {
    expect(checkLifecycleConsent(DELETED, null, LifecycleCampaign.DATA_HEALTH, 'consent_expiring')).toBe('recipient_unreachable');
  });

  it('blocks the latent case: a live user who clicked unsubscribe', () => {
    const unsubscribed = { ...LIVE, marketingOptOut: new Date('2026-08-01') };
    expect(checkLifecycleConsent(unsubscribed, null, LifecycleCampaign.REACTIVATION, 'whats_new')).toBe('marketing_opt_out');
  });

  it('still sends a service-interruption notice to that same unsubscribed user', () => {
    const unsubscribed = { ...LIVE, marketingOptOut: new Date('2026-08-01') };
    expect(checkLifecycleConsent(unsubscribed, null, LifecycleCampaign.DATA_HEALTH, 'consent_expiring')).toBeUndefined();
  });

  it('blocks a disabled category and names it', () => {
    expect(checkLifecycleConsent(LIVE, { growthEmailsEnabled: false }, LifecycleCampaign.REACTIVATION, 'whats_new')).toBe('growth_disabled');
  });

  it('does not let one category toggle suppress another', () => {
    expect(checkLifecycleConsent(LIVE, { weeklyInsightsEnabled: false }, LifecycleCampaign.REACTIVATION, 'whats_new')).toBeUndefined();
  });

  it('allows a live opted-in user with no preference row at all', () => {
    // No row means opted-in, matching EmailNotificationPreferenceService's
    // storedOrDefault semantics — a missing row must not mute mail.
    expect(checkLifecycleConsent(LIVE, null, LifecycleCampaign.REACTIVATION, 'whats_new')).toBeUndefined();
  });
});
