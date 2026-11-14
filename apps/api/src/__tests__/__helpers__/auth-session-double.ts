/**
 * A `@service/auth/better-auth` double for `tenant-http.ts`: the session is whoever the
 * `x-test-user` header names. Kept free of imports so a `vi.mock` factory can load it without
 * re-entering the module it replaces.
 */
export const TEST_USER_HEADER = 'x-test-user';

export function mockAuthSession() {
  return {
    authHandler: (_req: unknown, res: { sendStatus: (status: number) => unknown }) => res.sendStatus(404),
    getAuthSession: (headers: Record<string, string | string[] | undefined>) => {
      const id = headers[TEST_USER_HEADER];
      return Promise.resolve(typeof id === 'string' ? { session: { createdAt: new Date(), id: `session-${id}`, userId: id }, user: { email: `${id}@example.test`, id } } : null);
    },
    verifyTotpForSession: () => Promise.resolve(),
    // QR pairing's session operations. Inert here: a test that exercises pairing replaces
    // them (see `controller/__tests__/mobile-pairing.http.test.ts`), and every other route
    // only needs the module to resolve.
    createPairedSession: () => Promise.resolve({
      cookieName: 'better-auth.session_token',
      cookieValue: 'paired-token.signature',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      sessionId: 'paired-session-id',
      token: 'paired-token',
    }),
    deleteAuthSession: () => Promise.resolve(),
    endAllAuthSessions: () => Promise.resolve(),
    listAuthSessions: () => Promise.resolve([]),
  };
}
