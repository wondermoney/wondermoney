/**
 * Soft-delete filter infrastructure.
 *
 * ## The problem this addresses
 *
 * Every entity extends `Base` with a `deletedAt` column, but there is no global filter for
 * it — filtering is per-query and manual. The ratio is roughly 71 explicit `deletedAt`
 * sites against ~861 `find`/`findOne` calls, so the default is "remember or leak", and
 * three money paths had already forgotten: account metrics, budget spending (four copies),
 * and `getCategorySpending`. Those three are fixed directly; this module is the structural
 * prevention.
 *
 * One piece of good news worth recording: `{ deletedAt: undefined }` genuinely does work.
 * MikroORM's `ignoreUndefinedInQuery` defaults to `false` and the config never overrides
 * it, so `undefined` converts to `null` and emits `deleted_at IS NULL`. The idiom is
 * correct — just fragile, because omitting the key entirely is silent.
 *
 * ## Why this is NOT `default: true` yet
 *
 * Flipping the default globally is the right end state, but it is a behaviour change across
 * ~861 call sites and it cannot be validated by this repo's test suite: almost every test
 * mocks `DI.em`, and a mocked EntityManager never runs an ORM filter. The suite would stay
 * green while the behaviour changed underneath it — false confidence on precisely the
 * change that most needs real coverage.
 *
 * Two paths are already known to depend on seeing soft-deleted rows, and both are
 * load-bearing:
 *
 *   1. **The balance chain.** `loadChainRows` includes soft-deleted rows deliberately —
 *      "hidden in the UI does not mean the money did not move". Filtering them out silently
 *      changes every stored running balance.
 *   2. **Account resurrection.** `account-initial-sync-account.service.ts:191` searches for
 *      `deletedAt: { $ne: null }` to revive a soft-deleted account instead of
 *      re-inserting it into a unique violation. Under a default-on filter that predicate
 *      ANDs with `deleted_at IS NULL`, always returns empty, and every re-sync of a
 *      soft-deleted account fails on the unique constraint.
 *
 * Both are handled below. The blocker is the ones that are *not* yet enumerated.
 *
 * ## Adoption path
 *
 * Enable per entity, not all at once:
 *   1. Add `@Filter(softDeleteFilter())` to the entity.
 *   2. Grep its read paths; anything that needs deleted rows opts out with
 *      `withDeleted` below, which is greppable and self-documenting.
 *   3. Only then flip that entity's filter to `default: true`.
 *
 * Note this does **not** cover raw SQL / Kysely paths — those bypass ORM filters entirely and
 * still need explicit `deleted_at` predicates, which is exactly how the budget and metrics
 * bugs happened.
 */

export const SOFT_DELETE_FILTER = 'softDelete';

/** The filter condition: only rows that have not been soft-deleted. */
export const notDeletedCond = () => ({ deletedAt: null });

/**
 * Filter definition for an entity's `@Filter(...)` decorator.
 *
 * Pass `{ default: true }` only once the entity's read paths have been audited per the
 * adoption path above.
 */
export const softDeleteFilter = (options: { default?: boolean } = {}) => ({
  args: false as const,
  cond: notDeletedCond,
  default: options.default ?? false,
  name: SOFT_DELETE_FILTER,
});

/**
 * Explicit, greppable opt-out for the paths that legitimately need soft-deleted rows.
 *
 * Spread into a `FindOptions`:
 *
 * ```ts
 * await em.find(Transaction, where, { ...withDeleted(), orderBy });
 * ```
 *
 * This mirrors the escape hatch `loadChainRows` already uses for `HIDDEN_FILTER`, so the
 * two read the same way at a call site.
 */
export const withDeleted = () => ({ filters: { [SOFT_DELETE_FILTER]: false } });
