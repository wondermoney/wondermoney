import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { InternalServerError } from '@utils/errors';

import { assertTenantResolved } from '../tenant-scope';

describe('assertTenantResolved (fail-loud tenant guard)', () => {
  it('passes when an authenticated request has a resolved tenant', () => {
    const next = vi.fn();
    assertTenantResolved({ path: '/x', tenant: { tenantKey: 2 }, user: { appuserKey: 1 } } as unknown as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('passes through unauthenticated requests (no user, nothing to scope)', () => {
    const next = vi.fn();
    assertTenantResolved({ path: '/x' } as unknown as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('fails loud (500) when an authenticated request reaches a data route without a tenant', () => {
    const next = vi.fn();
    assertTenantResolved({ path: '/x', user: { appuserKey: 1 } } as unknown as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(InternalServerError));
  });
});
