import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

import { FinancialEmailCandidateRepository } from '../financial-email-candidate.repository';

describe('financial email candidate repository', () => {
  it('pages by appuser cursor with stored stream and current delivery gates', async () => {
    const execute = vi.fn().mockResolvedValue([{ appuserKey: 8 }, { appuserKey: 9 }]);
    const repository = new FinancialEmailCandidateRepository({ getConnection: () => ({ execute }) } as unknown as EntityManager);
    await expect(repository.page('budget', 7, 250)).resolves.toEqual([8, 9]);
    const [sql, parameters] = execute.mock.calls[0] as [string, unknown[]];
    expect(parameters).toEqual([7, 250]);
    // Opted-in by default: a missing/soft-deleted preference row still qualifies.
    expect(sql).toContain('coalesce(preference."budget_alerts_enabled", true) = true');
    expect(sql).toContain('owner."appuser_key" > ?');
    expect(sql).toContain('owner."record_active" = true');
    expect(sql).toContain('owner."deleted_at" is null');
    expect(sql).not.toContain('consent');
    expect(sql).not.toContain('marketing_opt_out');
  });

  it('uses the independent weekly preference column and caps page size', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const repository = new FinancialEmailCandidateRepository({ getConnection: () => ({ execute }) } as unknown as EntityManager);
    await repository.page('weekly', 0, 5_000);
    expect(execute.mock.calls[0]?.[0]).toContain('coalesce(preference."weekly_insights_enabled", true) = true');
    // No language gate: the renderer ships EN and PT, so a PT-only clause would exclude most
    // eligible users.
    expect(execute.mock.calls[0]?.[0]).not.toContain('language');
    expect(execute.mock.calls[0]?.[1]).toEqual([0, 500]);
  });

  it('pages monthlyStory candidates using the monthly_story_enabled column', async () => {
    const execute = vi.fn().mockResolvedValue([{ appuserKey: 11 }, { appuserKey: 12 }]);
    const repository = new FinancialEmailCandidateRepository({ getConnection: () => ({ execute }) } as unknown as EntityManager);
    await expect(repository.page('monthlyStory', 0, 250)).resolves.toEqual([11, 12]);
    const [sql, parameters] = execute.mock.calls[0] as [string, unknown[]];
    expect(parameters).toEqual([0, 250]);
    // Opted-in by default: a missing/soft-deleted preference row still qualifies.
    expect(sql).toContain('coalesce(preference."monthly_story_enabled", true) = true');
    expect(sql).toContain('owner."appuser_key" > ?');
    expect(sql).toContain('owner."record_active" = true');
    expect(sql).toContain('owner."deleted_at" is null');
  });

  it('excludes tenants holding an account stranded by the provider migration', () => {
    // These emails state a tenant's own figures. An account left on a legacy requisition (a
    // bank provider that no longer syncs) still has a balance but receives no new
    // transactions, so any total computed over it is silently short — and a confident wrong
    // number is worse than no email.
    //
    // This asserts the shape of the clause, which is all that is testable without a
    // database. The behaviour was verified by running the real query against production:
    // 15 budget candidates before the guard, 13 after, with 55 users excluded overall
    // (134 of 195 live accounts are stranded, across 64 tenants, none refreshed in 7 days).
    const execute = vi.fn().mockResolvedValue([]);
    const repository = new FinancialEmailCandidateRepository({ getConnection: () => ({ execute }) } as unknown as EntityManager);
    void repository.page('budget', 0, 250);
    const sql = execute.mock.calls[0]?.[0] as string;

    expect(sql).toContain('not exists');
    expect(sql).toContain('stranded."nordigen_requisition_key" is not null');
    expect(sql).toContain('stranded."enable_banking_connection_key" is null');
    // Scoped through the user's own household, and ignoring rows that cannot go stale.
    expect(sql).toContain('membership."appuser_key" = owner."appuser_key"');
    expect(sql).toContain('stranded."closed" = false');
    expect(sql).toContain('stranded."deleted_at" is null');
  });

  it('applies the stranded-account guard to every stream, not just budget', () => {
    // Weekly and Monthly Story aggregate the same ledger; a guard on one stream only would
    // leave the others mailing the same wrong totals.
    for (const stream of ['budget', 'weekly', 'monthlyStory'] as const) {
      const execute = vi.fn().mockResolvedValue([]);
      const repository = new FinancialEmailCandidateRepository({ getConnection: () => ({ execute }) } as unknown as EntityManager);
      void repository.page(stream, 0, 250);
      expect(execute.mock.calls[0]?.[0]).toContain('stranded."enable_banking_connection_key" is null');
    }
  });
});
