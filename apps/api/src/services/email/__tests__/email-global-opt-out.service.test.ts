import { createHmac } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailGlobalOptOutService, GLOBAL_EMAIL_OPT_OUT_CATEGORY, INVALID_EMAIL_OPT_OUT_TOKEN } from '../email-global-opt-out.service';
import { EmailCategory } from '../email-preferences';

const secret = 'a-secure-test-secret-that-is-longer-than-32-characters';
const now = new Date('2026-07-18T10:00:00.000Z');

describe('EmailGlobalOptOutService', () => {
  const execute = vi.fn();
  const tx = { getConnection: () => ({ execute }) };
  const transactional = vi.fn((callback: (em: typeof tx) => Promise<void>) => callback(tx));
  const service = new EmailGlobalOptOutService({ em: { transactional } as unknown as EntityManager, now: () => now, secret });

  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockImplementation((sql: string) => Promise.resolve(sql.startsWith('select') ? { appuserKey: 42 } : undefined));
  });

  it('generates and validates a versioned expiring token', () => {
    const token = service.generateToken(42, 60);
    expect(service.validateToken(token)).toEqual({ exp: Math.floor(now.getTime() / 1000) + 60, sub: 42, v: 1 });
  });

  it.each(['malformed', 'tampered'])('returns the same safe 4xx for a %s token', (kind) => {
    const token = kind === 'malformed' ? 'not-a-token' : `${service.generateToken(42, 60)}x`;
    expect(() => service.validateToken(token)).toThrow(INVALID_EMAIL_OPT_OUT_TOKEN);
  });

  it('rejects expired tokens and unknown signed versions', () => {
    expect(() => service.validateToken(service.generateToken(42, 1))).not.toThrow();
    const expired = new EmailGlobalOptOutService({ em: {} as unknown as EntityManager, now: () => new Date(now.getTime() + 2_000), secret });
    expect(() => expired.validateToken(service.generateToken(42, 1))).toThrow(INVALID_EMAIL_OPT_OUT_TOKEN);

    const encoded = Buffer.from(JSON.stringify({ exp: Math.floor(now.getTime() / 1000) + 60, sub: 42, v: 2 })).toString('base64url');
    const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
    expect(() => service.validateToken(`${encoded}.${signature}`)).toThrow(INVALID_EMAIL_OPT_OUT_TOKEN);
  });

  it('idempotently disables both streams for the account', async () => {
    const token = service.generateToken(42);

    await service.applyGlobalOptOut(token);
    await service.applyGlobalOptOut(token);

    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls[0]?.[0]).toContain('for update');
    expect(execute.mock.calls[1]?.[0]).toContain('"budget_alerts_enabled" = false, "weekly_insights_enabled" = false');
    expect(execute.mock.calls[2]?.[0]).toContain('for update');
    expect(execute.mock.calls[3]?.[0]).toContain('"budget_alerts_enabled" = false, "weekly_insights_enabled" = false');
  });

  it('does not reveal whether a valid token identifies an existing account', async () => {
    execute.mockResolvedValue(undefined);
    await expect(service.applyGlobalOptOut(service.generateToken(404))).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
  });

  describe('v2 category tokens', () => {
    it('round-trips a category token carrying its category', () => {
      const token = service.generateCategoryToken(42, EmailCategory.GROWTH, 60);
      expect(service.validateToken(token)).toEqual({ cat: EmailCategory.GROWTH, exp: Math.floor(now.getTime() / 1000) + 60, sub: 42, v: 2 });
    });

    it('round-trips the global sentinel category', () => {
      const token = service.generateCategoryToken(42, GLOBAL_EMAIL_OPT_OUT_CATEGORY, 60);
      expect(service.validateToken(token)).toEqual({ cat: 'all', exp: Math.floor(now.getTime() / 1000) + 60, sub: 42, v: 2 });
    });

    it('rejects an unknown category at generation time', () => {
      expect(() => service.generateCategoryToken(42, 'NOT_A_CATEGORY' as unknown as Parameters<EmailGlobalOptOutService['generateCategoryToken']>[1])).toThrow(INVALID_EMAIL_OPT_OUT_TOKEN);
    });

    it('applies a category token by disabling only that category flag', async () => {
      await service.applyOptOut(service.generateCategoryToken(42, EmailCategory.GROWTH));

      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls[0]?.[0]).toContain('for update');
      const updateSql = execute.mock.calls[1]?.[0] as string;
      expect(updateSql).toContain('"growth_emails_enabled"');
      expect(updateSql).not.toContain('budget_alerts_enabled');
      expect(updateSql).not.toContain('weekly_insights_enabled');
    });

    it('is idempotent when applying the same category token twice', async () => {
      const token = service.generateCategoryToken(42, EmailCategory.ACCOUNT_RECOVERY);
      await service.applyOptOut(token);
      await service.applyOptOut(token);
      expect(execute).toHaveBeenCalledTimes(4);
    });

    it('applies the global sentinel by setting marketingOptOut on the appuser, not a preference row', async () => {
      await service.applyOptOut(service.generateCategoryToken(42, GLOBAL_EMAIL_OPT_OUT_CATEGORY));

      expect(execute).toHaveBeenCalledTimes(2);
      const updateSql = execute.mock.calls[1]?.[0] as string;
      expect(updateSql).toContain('update "appuser"');
      expect(updateSql).toContain('marketing_opt_out');
    });

    it('does not reveal account existence for a category token either', async () => {
      execute.mockResolvedValue(undefined);
      await expect(service.applyOptOut(service.generateCategoryToken(404, EmailCategory.WEEKLY_INSIGHTS))).resolves.toBeUndefined();
      expect(execute).toHaveBeenCalledOnce();
    });

    it('still routes a v1 legacy token through applyOptOut to the unchanged budget+weekly behavior', async () => {
      await service.applyOptOut(service.generateToken(42));
      expect(execute.mock.calls[1]?.[0]).toContain('"budget_alerts_enabled" = false, "weekly_insights_enabled" = false');
    });
  });
});
