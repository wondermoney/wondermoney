import { describe, expect, it } from 'vitest';

import { parseInstanceAdminArgs } from '../instance-admin';

describe('the instance-admin command line', () => {
  it('reads grant, revoke and list', () => {
    expect(parseInstanceAdminArgs(['grant', 'ada@example.com'])).toEqual({ command: 'grant', email: 'ada@example.com' });
    expect(parseInstanceAdminArgs(['revoke', 'ada@example.com'])).toEqual({ command: 'revoke', email: 'ada@example.com' });
    expect(parseInstanceAdminArgs(['list'])).toEqual({ command: 'list' });
  });

  it('refuses anything else rather than guessing', () => {
    for (const args of [[], ['grant'], ['grant', 'not-an-email'], ['grant', 'a@example.com', 'b@example.com'], ['promote', 'a@example.com'], ['list', 'a@example.com']]) {
      expect(() => parseInstanceAdminArgs(args)).toThrow(/Usage/);
    }
  });
});
