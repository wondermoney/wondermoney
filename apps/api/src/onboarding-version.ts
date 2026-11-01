/**
 * Current onboarding content version. Bump this constant when the
 * journey (net-worth value, read-only bank access, privacy) changes enough
 * that prior completion no longer represents a current understanding of the
 * product. Users who completed an older version will be re-prompted; users
 * whose only completion is the pre-versioned legacy step are protected
 * forever and are never re-prompted.
 */
export const CURRENT_ONBOARDING_VERSION = 1 as const;

/**
 * The boundary between "already existed" and "signed up after the journey
 * started working".
 *
 * Legacy completion cannot be inferred from the presence of an
 * `appuser_onboarding` row: `AppuserRepository.createUser` attaches the step-1
 * row to every user at registration. That row stays because step 1 is web's
 * dashboard product tour (`components/onboarding/DashboardOnboarding.tsx` shows
 * it when step 1 is not done) and pre-marking it is what suppresses the tour, so
 * the versioned flow does not read those rows at all.
 *
 * A creation-date cutoff is what actually separates the two cohorts. Everyone
 * who existed when this shipped stays protected forever without a migration or
 * a backfill; only accounts created afterwards are asked to onboard. Deliberate
 * product decision: existing users are not re-prompted.
 *
 * This is not a version bump — bumping `CURRENT_ONBOARDING_VERSION` re-prompts
 * completed users by design, which is the opposite of what this constant is
 * for. Leave it alone when the journey's content changes.
 */
export const ONBOARDING_REQUIRED_FOR_USERS_CREATED_FROM = new Date('2026-08-24T00:00:00.000Z');
