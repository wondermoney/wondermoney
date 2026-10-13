import type { Request } from 'express';

import type { Tenant } from '@entity/Tenant';
import { InternalServerError, UnauthorizedError } from '@utils/errors';

/**
 * Read the authenticated user and resolved tenant off a request.
 *
 * ## Why this exists
 *
 * `req.user` and `req.tenant` are optional on `Express.Request`, and correctly so — on a
 * public route neither exists. But on a route mounted behind `authedTenant` both are
 * guaranteed, and ~129 call sites said so with a non-null assertion
 * (`req.user!.appuserKey`). That has two costs:
 *
 *   1. `!` asserts to the *compiler* and checks nothing at runtime. If a route is ever
 *      mounted without the middleware that populates these, the assertion is silently wrong
 *      and the handler proceeds with `undefined` — which is exactly the shape of the
 *      `/v1/operations` mount that had lost `resolveTenantForRequest` entirely.
 *   2. It is indistinguishable, to a reader or a linter, from the `arr[i]!` assertions that
 *      `noUncheckedIndexedAccess` forces and which carry no such risk.
 *
 * This helper makes the guarantee explicit and *enforced*: a mis-wired route fails loudly
 * with a 500 naming the missing piece, rather than producing wrong data quietly.
 *
 * The alternative considered was a typed `AuthedRequest`. Under `strictFunctionTypes` a
 * handler taking a narrower request is not assignable to `RequestHandler`, so it needs a
 * casting wrapper at every one of ~200 route registrations — a large diff, and the cast
 * would re-introduce the same unchecked assumption this replaces.
 */

export interface AuthedContext {
  appuserKey: number;
  tenant: Tenant;
  tenantKey: number;
  user: NonNullable<Request['user']>;
}

/**
 * Both user and tenant. Use on routes behind `authedTenant`.
 *
 * The two failures are deliberately NOT the same status, because the codebase already drew
 * that line and clients depend on it:
 *
 *   - **Missing user → 401.** This is the contract the handlers already had (and that
 *     `account-transactions-update-scope.test.ts` asserts). A refactor must not silently turn
 *     a 401 into a 500 — it would page Sentry for an ordinary expired session and change what
 *     clients see.
 *   - **Missing tenant → 500.** A request that authenticated but arrived without a resolved
 *     tenant is a wiring bug on our side, which the caller cannot fix by re-authenticating.
 *     `assertTenantResolved` already treats it exactly this way.
 */
export function authedContext(req: Request): AuthedContext {
  const { tenant, user } = req;
  if (!user) {
    throw new UnauthorizedError('Authenticated user is missing.');
  }
  if (!tenant) {
    throw new InternalServerError('Tenant is not resolved — this route is not behind `resolveTenantForRequest`.');
  }
  return { appuserKey: user.appuserKey, tenant, tenantKey: tenant.tenantKey, user };
}

/**
 * The authenticated user only, for routes behind `requireAuth` + `getUser` but deliberately
 * not tenant-scoped (account deletion, for instance).
 */
export function authedUser(req: Request): NonNullable<Request['user']> {
  const { user } = req;
  if (!user) {
    throw new UnauthorizedError('Authenticated user is missing.');
  }
  return user;
}
