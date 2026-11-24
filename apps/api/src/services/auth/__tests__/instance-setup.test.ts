import { describe, expect, it, vi } from 'vitest';

vi.mock('@utils/logger', () => ({ default: { warn: vi.fn() } }));

import { setupRequiredCheck } from '@service/auth/instance-setup';

describe('whether a server still needs its first account', () => {
  it('needs setup while there is no user, and not once there is one', async () => {
    let users = 0;
    const isSetupRequired = setupRequiredCheck(() => Promise.resolve(users > 0));

    expect(await isSetupRequired()).toBe(true);
    expect(await isSetupRequired()).toBe(true);
    users = 1;
    expect(await isSetupRequired()).toBe(false);
  });

  it('stops asking the database once the server has a user, even if that user is deleted', async () => {
    const hasAnyUser = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const isSetupRequired = setupRequiredCheck(hasAnyUser);

    expect(await isSetupRequired()).toBe(false);
    expect(await isSetupRequired()).toBe(false);
    expect(hasAnyUser).toHaveBeenCalledOnce();
  });

  it('shows the usual sign-in when the lookup fails, and asks again next time', async () => {
    const hasAnyUser = vi.fn().mockRejectedValueOnce(new Error('connection refused')).mockResolvedValue(false);
    const isSetupRequired = setupRequiredCheck(hasAnyUser);

    expect(await isSetupRequired()).toBe(false);
    expect(await isSetupRequired()).toBe(true);
  });
});
