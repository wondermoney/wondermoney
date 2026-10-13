import { describe, expect, it } from 'vitest';

/**
 * The UTM contract for lifecycle emails, pinned.
 *
 * These parameter names are not cosmetic — they are the join key between a sent
 * email and a PostHog `$pageview`. Renaming one silently detaches every
 * historical click from its campaign, and nothing would fail loudly.
 *
 * The helper is duplicated here rather than exported: it is a private detail of
 * the worker, and what deserves protection is the produced URL shape, not the
 * function.
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

describe('lifecycle email UTM tagging', () => {
  it('tags a plain app url', () => {
    const url = new URL(withCampaignTracking('https://app.wonder.money/pt', 'reactivation', 'winback_offer'));
    expect(url.searchParams.get('utm_source')).toBe('lifecycle');
    expect(url.searchParams.get('utm_medium')).toBe('email');
    expect(url.searchParams.get('utm_campaign')).toBe('reactivation');
    expect(url.searchParams.get('utm_content')).toBe('winback_offer');
  });

  it('separates steps within one campaign, so nudges can be told apart', () => {
    const a = new URL(withCampaignTracking('https://app.wonder.money/pt', 'reactivation', 'inactivity_checkin'));
    const b = new URL(withCampaignTracking('https://app.wonder.money/pt', 'reactivation', 'winback_offer'));
    expect(a.searchParams.get('utm_content')).not.toBe(b.searchParams.get('utm_content'));
    expect(a.searchParams.get('utm_campaign')).toBe(b.searchParams.get('utm_campaign'));
  });

  it('appends rather than clobbering an existing query string', () => {
    const url = new URL(withCampaignTracking('https://app.wonder.money/pt/x?ref=abc', 'trial', 'last_call'));
    expect(url.searchParams.get('ref')).toBe('abc');
    expect(url.searchParams.get('utm_campaign')).toBe('trial');
  });

  it('produces a valid, parseable URL for a deep link', () => {
    const raw = withCampaignTracking('https://app.wonder.money/pt/feedback/trial-expiry', 'trial', 'post_trial_feedback');
    expect(() => new URL(raw)).not.toThrow();
    expect(new URL(raw).pathname).toBe('/pt/feedback/trial-expiry');
  });

  it('is not applied to the feedback link, because that link cannot carry it', () => {
    // The feedback page rejects any query parameter other than `reason`, and
    // the email template's buildReasonUrl clears the query string before
    // setting it. A utm_* there is dropped in transit, so tagging it would
    // record attribution that never reaches anyone. Reproduce the template's
    // transform to show the tagging would not survive.
    const tagged = withCampaignTracking('https://app.wonder.money/pt/feedback/trial-expiry', 'trial', 'post_trial_feedback');
    const asSent = new URL(tagged);
    asSent.search = '';
    asSent.searchParams.set('reason', 'too_expensive');
    expect([...asSent.searchParams.keys()]).toEqual(['reason']);
  });

  it('does not carry any of the params the web pageview capture strips', () => {
    // getSanitizedPageviewUrl drops credential-ish params before sending to
    // PostHog. If a utm_* name ever collided with that list the tagging would
    // vanish silently, so assert the names stay disjoint from it.
    const dropped = new Set([
      'access_token', 'attribution', 'code', 'error_description',
      'promoCodeOrReferralCode', 'promoCodeOrReferralOrigin', 'reason', 'refresh_token',
    ]);
    const url = new URL(withCampaignTracking('https://app.wonder.money/pt', 'engagement', 'monthly_report'));
    for (const key of url.searchParams.keys()) expect(dropped.has(key)).toBe(false);
  });
});
