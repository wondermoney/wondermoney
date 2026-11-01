import { describe, expect, it } from 'vitest';

import { BASELINE_MIGRATION, planBaseline, planMigrations, shouldSeedReferenceData } from '@app/migrate';

/**
 * The container entrypoint is `node dist/migrate.js && exec node dist/server.js`, so a
 * migration that fails takes the whole deploy with it — the server never starts and the
 * health check never reports the new commit.
 *
 * That is the correct default for ordinary additive DDL and the wrong one for a migration
 * that rewrites a large table under ACCESS EXCLUSIVE with a 5s `lock_timeout`. This rule is
 * what keeps the second kind out of the startup path, so it is worth testing directly.
 */
describe('migration hold-back plan', () => {
  const manual = new Set(['Migration_HEAVY']);

  it('applies everything when nothing pending is manual', () => {
    const plan = planMigrations([{ name: 'Migration_A' }, { name: 'Migration_B' }], { manual });
    expect(plan).toEqual({ apply: 'all', held: [] });
  });

  it('applies nothing when the very next migration is manual', () => {
    // The API then starts on the current schema rather than failing to start at all.
    const plan = planMigrations([{ name: 'Migration_HEAVY' }, { name: 'Migration_C' }], { manual });
    expect(plan).toEqual({ apply: 'none', held: ['Migration_HEAVY', 'Migration_C'] });
  });

  it('applies up to the migration before the first manual one', () => {
    const plan = planMigrations(
      [{ name: 'Migration_A' }, { name: 'Migration_B' }, { name: 'Migration_HEAVY' }],
      { manual },
    );
    expect(plan).toEqual({ apply: 'upTo', held: ['Migration_HEAVY'], upTo: 'Migration_B' });
  });

  it('holds back everything after the first manual one, not just the manual ones', () => {
    // Order matters: a later migration may depend on the held-back one, so applying it
    // would be applying against a schema that does not exist yet.
    const plan = planMigrations(
      [{ name: 'Migration_A' }, { name: 'Migration_HEAVY' }, { name: 'Migration_LATER' }],
      { manual },
    );
    expect(plan).toEqual({ apply: 'upTo', held: ['Migration_HEAVY', 'Migration_LATER'], upTo: 'Migration_A' });
  });

  it('applies everything when explicitly asked to, which is what `pnpm migrate:manual` does', () => {
    const plan = planMigrations([{ name: 'Migration_HEAVY' }], { applyManual: true, manual });
    expect(plan).toEqual({ apply: 'all', held: [] });
  });

  it('matches on the class name regardless of the compiled file extension', () => {
    // Pending entries are `.ts` in development and `.js` from `dist` in production.
    expect(planMigrations([{ name: 'Migration_HEAVY.js' }], { manual }).apply).toBe('none');
    expect(planMigrations([{ name: 'Migration_HEAVY.ts' }], { manual }).apply).toBe('none');
  });

});

describe('module entrypoint guard', () => {
  it('does not start a migration run merely because the module was imported', async () => {
    // If `main()` ran at module scope, this very import would open a `pg` client and try to
    // take the advisory lock. With no database reachable it rejects, and whether that surfaces
    // is a race against the test run finishing — green locally, Unhandled Rejection and exit 1
    // in CI, with every test file passing. A failing build with nothing failing in it.
    //
    // Importing must be inert. If the guard regresses, the unhandled rejection returns and
    // this file is the one holding the import that causes it.
    const rejections: unknown[] = [];
    const capture = (reason: unknown) => void rejections.push(reason);
    process.on('unhandledRejection', capture);
    try {
      const module = await import('../migrate.js');
      expect(typeof module.planMigrations).toBe('function');
      // Give any stray promise a turn to reject before we look.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off('unhandledRejection', capture);
    }
    expect(rejections).toEqual([]);
  });
});

describe('fresh database', () => {
  it('applies every migration, manual ones included, when none has ever run', () => {
    const pending = [{ name: 'Migration_A' }, { name: 'Migration_HEAVY' }, { name: 'Migration_C' }];
    const manual = new Set(['Migration_HEAVY']);
    expect(planMigrations(pending, { freshDatabase: true, manual })).toEqual({ apply: 'all', held: [] });
    expect(planMigrations(pending, { manual }).apply).toBe('upTo');
  });
});

describe('baseline migration', () => {
  // The original chain, as recorded on a database that ran all of it.
  const chainHead = ['Migration20260915190000', 'Migration20260915190100', 'Migration20260915190200', 'Migration20261024100000'];
  const fullChain = ['Migration20240228172453', 'Migration20240229184026', ...chainHead];
  // What a WonderMoney 1.0.0 install recorded: the chain up to Migration20261004120000.
  const release100 = [
    'Migration20240228172453',
    'Migration20260915190000',
    'Migration20260915190100',
    'Migration20260915190200',
    'Migration20261004120000',
  ];

  it('runs the baseline on a database no migration has touched', () => {
    expect(planBaseline([])).toEqual({ action: 'run' });
  });

  it('only records the baseline on a database that ran the whole original chain', () => {
    // Running it there would fail on the first `CREATE TABLE`: the schema is already there.
    expect(planBaseline(fullChain)).toEqual({ action: 'mark', replay: [] });
    expect(planBaseline(fullChain.map((name) => `${name}.js`))).toEqual({ action: 'mark', replay: [] });
  });

  it('upgrades a 1.0.0 install by replaying the chain it never ran, then recording the baseline', () => {
    // Self-hosters on the published 1.0.0 images have no release that ran the rest of the chain.
    expect(planBaseline(release100)).toEqual({
      action: 'mark',
      replay: ['Migration20261024092755', 'Migration20261024100000'],
    });
    expect(planBaseline([...release100, 'Migration20261024092755'])).toEqual({
      action: 'mark',
      replay: ['Migration20261024100000'],
    });
  });

  it('does nothing once the baseline is recorded', () => {
    expect(planBaseline([...fullChain, BASELINE_MIGRATION])).toEqual({ action: 'done' });
    expect(planBaseline([...release100, BASELINE_MIGRATION])).toEqual({ action: 'done' });
    expect(planBaseline([BASELINE_MIGRATION])).toEqual({ action: 'done' });
  });

  it('refuses a database that stopped part-way through the original chain', () => {
    // Marking it would claim a schema it does not have; running the baseline would fail.
    expect(() => planBaseline(['Migration20240228172453', 'Migration20260101000000'])).toThrow(/part-way/);
  });

  it('refuses a database that skipped the held-back maintenance-window migrations', () => {
    const skippedHeld = fullChain.filter((name) => !name.startsWith('Migration2026091519'));
    expect(() => planBaseline(skippedHeld)).toThrow(/part-way/);
    expect(() => planBaseline(release100.filter((name) => !name.startsWith('Migration2026091519')))).toThrow(/part-way/);
  });
});

describe('first-boot reference data', () => {
  it('loads it into a database that has none', () => {
    expect(shouldSeedReferenceData(false, {})).toBe(true);
  });

  it('never re-seeds a database that already has it', () => {
    expect(shouldSeedReferenceData(true, {})).toBe(false);
  });

  it('can be switched off', () => {
    expect(shouldSeedReferenceData(false, { SEED_REFERENCE_DATA: 'false' })).toBe(false);
  });
});
