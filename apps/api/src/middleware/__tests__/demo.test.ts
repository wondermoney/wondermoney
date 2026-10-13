import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AppuserAccountType } from '@entity/Appuser';
import { TenantType } from '@entity/Tenant';

import { mockRes } from '../../__tests__/__helpers__/mock-request';

describe('demo middleware', () => {
  it('detects demo appuser requests', async () => {
    const { isDemoRequest } = await import('../demo');
    expect(isDemoRequest({ user: { accountType: AppuserAccountType.DEMO } } as Request)).toBe(true);
  });

  it('detects legacy demo email requests', async () => {
    const { isDemoRequest } = await import('../demo');
    expect(isDemoRequest({ user: { emailAddress: 'demo@wonder.money' } } as Request)).toBe(true);
  });

  it('detects demo tenant requests', async () => {
    const { isDemoRequest } = await import('../demo');
    expect(isDemoRequest({ tenant: { tenantType: TenantType.DEMO } } as Request)).toBe(true);
  });

  it('does not detect regular requests', async () => {
    const { isDemoRequest } = await import('../demo');
    expect(
      isDemoRequest({
        tenant: { tenantType: TenantType.REGULAR },
        user: { accountType: AppuserAccountType.REGULAR },
      } as Request),
    ).toBe(false);
  });

  it('allows safe demo mutation methods', async () => {
    const { blockDemoMutation } = await import('../demo');
    const next = vi.fn();

    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      blockDemoMutation({ method, user: { accountType: AppuserAccountType.DEMO } } as Request, mockRes(), next);
      expect(next).toHaveBeenCalled();
      next.mockClear();
    }
  });

  it('blocks unsafe demo mutation methods', async () => {
    const { blockDemoMutation, DEMO_READ_ONLY_CODE, DEMO_READ_ONLY_MESSAGE } = await import('../demo');
    const next = vi.fn();
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });

    blockDemoMutation(
      { method: 'POST', user: { accountType: AppuserAccountType.DEMO } } as Request,
      mockRes({ status }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ code: DEMO_READ_ONLY_CODE, message: DEMO_READ_ONLY_MESSAGE });
  });

  it('blocks demo state changes even on GET', async () => {
    const { blockDemoStateChange, DEMO_READ_ONLY_CODE, DEMO_READ_ONLY_MESSAGE } = await import('../demo');
    const next = vi.fn();
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });

    blockDemoStateChange(
      { method: 'GET', tenant: { tenantType: TenantType.DEMO } } as Request,
      mockRes({ status }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ code: DEMO_READ_ONLY_CODE, message: DEMO_READ_ONLY_MESSAGE });
  });

  it('blocks regular users attached to demo tenants before downstream side effects', async () => {
    const { blockDemoMutation } = await import('../demo');
    const next = vi.fn();
    const status = vi.fn().mockReturnValue({ json: vi.fn() });

    blockDemoMutation(
      {
        method: 'POST',
        tenant: { tenantType: TenantType.DEMO },
        user: { accountType: AppuserAccountType.REGULAR },
      } as Request,
      mockRes({ status }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('allows non-demo unsafe methods', async () => {
    const { blockDemoMutation } = await import('../demo');
    const next = vi.fn();

    blockDemoMutation(
      { method: 'DELETE', user: { accountType: AppuserAccountType.REGULAR } } as Request,
      mockRes(),
      next,
    );

    expect(next).toHaveBeenCalledWith();
  });
});
