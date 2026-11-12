import type { TokenSnapshotResult } from '../auth/auth-recovery'

/** How long one token read serves every image that asks for it (a list mounts many at once). */
const AUTHORIZATION_REUSE_MS = 30_000

/**
 * The `Authorization` value for API-served images, from the runtime's own token source. Reads are
 * shared for a short while so a list of avatars asks once, not once per row. Null when there is
 * no session. The value is only ever placed in a request header; never log it.
 */
export function createImageAuthorization(
  getTokenSnapshot: () => Promise<TokenSnapshotResult>,
  now: () => number = Date.now,
): () => Promise<string | null> {
  let shared: { at: number; value: Promise<string | null> } | null = null
  return () => {
    if (shared && now() - shared.at < AUTHORIZATION_REUSE_MS) return shared.value
    const value = getTokenSnapshot()
      .then((result) => (result.status === 'available' ? `Bearer ${result.snapshot.accessToken}` : null))
      .catch(() => null)
    shared = { at: now(), value }
    // A missing session is not cached: the next image asks again.
    void value.then((authorization) => { if (authorization === null && shared?.value === value) shared = null })
    return value
  }
}
