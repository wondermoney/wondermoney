import { userPreferencesSchema } from '@validators/preferences';

import { aiCapabilities, type AiFeature } from './ai-provider';

/** The shape this needs from an `Appuser`, so a partially loaded one (a reference) is accepted. */
type PreferencesOwner = null | undefined | { preferences?: Record<string, unknown> };

/**
 * Whether this person turned every AI feature off for their own account.
 *
 * The preference lives on `appuser.preferences` and is parsed through the same schema as every
 * other preference, so a row written by an older release (no key) reads as "not hidden". A
 * malformed document reads the same way rather than throwing on a request path.
 */
export function isAiHidden(appuser: PreferencesOwner): boolean {
  return userPreferencesSchema.safeParse(appuser?.preferences ?? {}).data?.aiHidden ?? false;
}

/**
 * Whether `feature` may run for this person: the instance needs a provider for it *and* the
 * person must not have hidden AI. Hiding wins over an instance that has the feature configured.
 */
export function isAiAllowedFor(
  appuser: PreferencesOwner,
  feature: AiFeature,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return !isAiHidden(appuser) && aiCapabilities(env)[feature];
}

/**
 * The per-user view of `GET /v1/instance`'s `features.ai`: every feature reported off once the
 * person hides AI, so a client can gate on one document without combining two sources itself.
 */
export function effectiveAiCapabilities(
  appuser: PreferencesOwner,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<AiFeature, boolean> {
  const capabilities = aiCapabilities(env);
  if (!isAiHidden(appuser)) return capabilities;
  return Object.fromEntries(Object.keys(capabilities).map((feature) => [feature, false])) as Record<AiFeature, boolean>;
}
