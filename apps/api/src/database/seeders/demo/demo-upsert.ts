import type { EntityData, EntityManager, EntityName, FilterQuery } from '@mikro-orm/core';

/** Fixtures converge on stable household-scoped identities across seeds and daily refreshes. */
export async function upsertDemoRow<T extends object>(
  em: EntityManager,
  entity: EntityName<T>,
  criteria: NoInfer<FilterQuery<T>>,
  data: EntityData<NoInfer<T>>,
): Promise<T> {
  const existing = await em.findOne<T>(entity, criteria);
  if (existing) {
    Object.assign(existing, data);
    return existing;
  }
  return em.create(entity, data, { partial: true });
}
