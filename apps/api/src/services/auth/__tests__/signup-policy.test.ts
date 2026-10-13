import { describe, expect, it, vi } from 'vitest';

import { isSignupAllowed, resolveSignupMode } from '../signup-policy';

const deps = (overrides: { hasAnyUser?: boolean; hasPendingInvite?: boolean } = {}) => ({
  hasAnyUser: vi.fn().mockResolvedValue(overrides.hasAnyUser ?? true),
  hasPendingInvite: vi.fn().mockResolvedValue(overrides.hasPendingInvite ?? false),
});

describe('resolveSignupMode', () => {
  it('is open unless configured otherwise', () => {
    expect(resolveSignupMode({})).toBe('open');
    expect(resolveSignupMode({ SIGNUP_MODE: 'invite' })).toBe('invite');
    expect(resolveSignupMode({ SIGNUP_MODE: 'closed' })).toBe('closed');
  });

  it('fails closed on a value it does not recognise', () => {
    expect(resolveSignupMode({ SIGNUP_MODE: 'opne' })).toBe('closed');
  });
});

describe('isSignupAllowed', () => {
  it('lets anyone sign up in open mode', async () => {
    await expect(isSignupAllowed('a@example.com', deps(), { SIGNUP_MODE: 'open' })).resolves.toBe(true);
  });

  it('refuses new accounts in closed mode', async () => {
    await expect(isSignupAllowed('a@example.com', deps(), { SIGNUP_MODE: 'closed' })).resolves.toBe(false);
  });

  it('admits only an email with a pending household invite in invite mode', async () => {
    await expect(isSignupAllowed('a@example.com', deps({ hasPendingInvite: true }), { SIGNUP_MODE: 'invite' })).resolves.toBe(true);
    await expect(isSignupAllowed('a@example.com', deps({ hasPendingInvite: false }), { SIGNUP_MODE: 'invite' })).resolves.toBe(false);
  });

  it('always admits the first account on an empty instance, so its owner is never locked out', async () => {
    const d = deps({ hasAnyUser: false });
    await expect(isSignupAllowed('owner@example.com', d, { SIGNUP_MODE: 'closed' })).resolves.toBe(true);
    expect(d.hasPendingInvite).not.toHaveBeenCalled();
  });

  it('checks the invite against the normalised address', async () => {
    const d = deps({ hasPendingInvite: true });
    await isSignupAllowed('  Person@Example.COM ', d, { SIGNUP_MODE: 'invite' });
    expect(d.hasPendingInvite).toHaveBeenCalledWith('person@example.com');
  });
});
