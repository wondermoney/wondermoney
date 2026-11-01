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
      return Promise.resolve(typeof id === 'string' ? { session: { id: `session-${id}`, userId: id }, user: { email: `${id}@example.test`, id } } : null);
    },
  };
}
