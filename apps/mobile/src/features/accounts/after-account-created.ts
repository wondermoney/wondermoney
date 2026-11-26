import type { Href } from 'expo-router'

/** The search parameter value that sends a new manual account on to the statement import. */
export const THEN_IMPORT = 'import'

/**
 * Where a new manual account leads: the statement import when the person came to import one
 * (`then=import`: Home's or onboarding's "Import a statement" with no account to import into),
 * otherwise `fallback`. A statement goes into an account, so the account comes first.
 */
export function afterAccountCreated(then: string | string[] | undefined, fallback: string): Href {
  const value = Array.isArray(then) ? then[0] : then
  return (value === THEN_IMPORT ? '/accounts/transactions/import' : fallback) as Href
}
