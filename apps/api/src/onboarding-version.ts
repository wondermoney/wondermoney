/**
 * RAD-226 — current onboarding content version. Bump this constant when the
 * journey (net-worth value, read-only bank access, privacy) changes enough
 * that prior completion no longer represents a current understanding of the
 * product. Users who completed an older version will be re-prompted; users
 * whose only completion is the pre-versioned legacy step are protected
 * forever and are never re-prompted.
 */
export const CURRENT_ONBOARDING_VERSION = 1 as const;

export type OnboardingVersion = typeof CURRENT_ONBOARDING_VERSION;

/**
 * RAD-601 — the boundary between "already existed" and "signed up after the
 * journey started working".
 *
 * The versioned bootstrap used to infer legacy completion from the presence of
 * any `appuser_onboarding` row, on the assumption that only pre-versioning
 * users carried one. That was never true: `AppuserRepository.createUser`
 * attaches the step-1 row to every user at registration, so every account
 * created since RAD-226 resolved to `completed:true, required:false` and no
 * new user ever saw the first-run journey on web or mobile.
 *
 * Dropping that row from `createUser` would have fixed the bootstrap and, as a
 * side effect, switched on web's dashboard product tour — step 1 is that tour
 * (`components/onboarding/DashboardOnboarding.tsx` shows it when step 1 is not
 * done), and pre-marking it is the only thing currently suppressing it. So the
 * rows are left exactly as they are and the versioned flow stops reading them.
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
