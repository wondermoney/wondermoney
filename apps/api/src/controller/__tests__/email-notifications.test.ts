import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyGlobalOptOut: vi.fn(),
  getForAppuser: vi.fn(),
  patchForAppuser: vi.fn(),
  validateToken: vi.fn(),
}));

vi.mock('@service/email/email-global-opt-out.service', () => ({
  emailGlobalOptOutService: { applyGlobalOptOut: mocks.applyGlobalOptOut, validateToken: mocks.validateToken },
}));
vi.mock('@service/email/email-notification-preference.service', () => ({
  emailNotificationPreferenceService: { getForAppuser: mocks.getForAppuser, patchForAppuser: mocks.patchForAppuser },
}));

import { applyGlobalEmailOptOut, getEmailNotificationPreferences, inspectGlobalEmailOptOut, patchEmailNotificationPreferences } from '../email-notifications';

describe('email notification controllers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the typed preference state for the authenticated appuser', async () => {
    const state = { budgetAlerts: { deliverySupported: true, effectiveEnabled: false, marketingEligible: true, storedEnabled: false } };
    mocks.getForAppuser.mockResolvedValue(state);
    const json = vi.fn();

    await getEmailNotificationPreferences({ user: { appuserKey: 7 } } as Request, { json } as unknown as Response);

    expect(mocks.getForAppuser).toHaveBeenCalledWith(7);
    expect(json).toHaveBeenCalledWith(state);
  });

  it('passes a validated partial patch to the service', async () => {
    const state = { weeklyInsights: { storedEnabled: false } };
    mocks.patchForAppuser.mockResolvedValue(state);
    const json = vi.fn();

    await patchEmailNotificationPreferences(
      { body: { weeklyInsightsEnabled: false }, user: { appuserKey: 7 } } as Request,
      { json } as unknown as Response,
    );

    expect(mocks.patchForAppuser).toHaveBeenCalledWith(7, { weeklyInsightsEnabled: false });
    expect(json).toHaveBeenCalledWith(state);
  });

  it('requires at least one PATCH field at the controller boundary', async () => {
    await expect(
      patchEmailNotificationPreferences({ body: {}, user: { appuserKey: 7 } } as Request, { json: vi.fn() } as unknown as Response),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.patchForAppuser).not.toHaveBeenCalled();
  });

  it('validates GET without mutation and applies only strict RFC one-click POST', async () => {
    const json = vi.fn();
    const set = vi.fn();
    const sendStatus = vi.fn();

    await inspectGlobalEmailOptOut({ query: { token: 'signed-token' } } as unknown as Request, { json, set } as unknown as Response);
    expect(mocks.validateToken).toHaveBeenCalledWith('signed-token');
    expect(mocks.applyGlobalOptOut).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ action: 'confirm_global_email_opt_out' });

    await applyGlobalEmailOptOut({ body: { 'List-Unsubscribe': 'One-Click' }, query: { token: 'signed-token' } } as unknown as Request, { sendStatus, set } as unknown as Response);
    expect(mocks.applyGlobalOptOut).toHaveBeenCalledWith('signed-token');
    expect(sendStatus).toHaveBeenCalledWith(204);
    expect(set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(set).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
  });

  it.each([
    [{ body: {}, query: { token: 'signed-token' } }, 'missing marker'],
    [{ body: { 'List-Unsubscribe': 'one-click' }, query: { token: 'signed-token' } }, 'wrong marker'],
    [{ body: { 'List-Unsubscribe': 'One-Click' }, query: {} }, 'missing query token'],
    [{ body: { 'List-Unsubscribe': 'One-Click', token: 'body-token' }, query: { token: 'signed-token' } }, 'body token'],
  ])('rejects strict POST shape: %s', async (request, _label) => {
    await expect(applyGlobalEmailOptOut(request as unknown as Request, { set: vi.fn() } as unknown as Response)).rejects.toMatchObject({ status: 400 });
    expect(mocks.applyGlobalOptOut).not.toHaveBeenCalled();
  });

  it('sets privacy headers before malformed GET and POST validation fails', async () => {
    const getSet = vi.fn();
    const postSet = vi.fn();
    await expect(inspectGlobalEmailOptOut({ query: {} } as Request, { set: getSet } as unknown as Response)).rejects.toMatchObject({ status: 400 });
    await expect(applyGlobalEmailOptOut({ body: {}, query: {} } as Request, { set: postSet } as unknown as Response)).rejects.toMatchObject({ status: 400 });
    for (const set of [getSet, postSet]) {
      expect(set).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(set).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
    }
  });
});
