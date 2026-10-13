import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { authedContext, authedUser } from '@middleware/authed-context';

const user = { appuserKey: 42 } as NonNullable<Request['user']>;
const tenant = { tenantKey: 7 } as NonNullable<Request['tenant']>;

describe('authed context', () => {
  it('returns the user and tenant when the middleware populated them', () => {
    const context = authedContext({ tenant, user } as Request);
    expect(context.appuserKey).toBe(42);
    expect(context.tenantKey).toBe(7);
    expect(context.user).toBe(user);
    expect(context.tenant).toBe(tenant);
  });

  it('raises 401 for a missing user, preserving the handlers\' existing contract', () => {
    // The handlers already returned 401 here and a test asserts it. A mechanical refactor
    // must not turn an ordinary expired session into a Sentry-paging 500.
    expect(() => authedContext({ tenant } as Request)).toThrow(expect.objectContaining({ status: 401 }));
  });

  it('fails loudly when the route is not behind resolveTenantForRequest', () => {
    expect(() => authedContext({ user } as Request)).toThrow(/not behind `resolveTenantForRequest`/);
  });

  it('raises 500 for a missing tenant — our wiring bug, not bad credentials', () => {
    // The caller cannot fix this by re-authenticating. `assertTenantResolved` agrees.
    expect(() => authedContext({ user } as Request)).toThrow(expect.objectContaining({ status: 500 }));
  });

  it('authedUser allows a tenant-less route', () => {
    // Account deletion is authenticated but deliberately not tenant-gated.
    expect(authedUser({ user } as Request)).toBe(user);
    expect(() => authedUser({} as Request)).toThrow(expect.objectContaining({ status: 401 }));
  });
});
