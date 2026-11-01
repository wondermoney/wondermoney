/**
 * Typed MikroORM `EntityManager` helpers that localize the unavoidable branded-PK casts.
 *
 * `getReference` takes `Primary<T>` which is a deeply conditional type that callers
 * usually just have as `number`. Without this helper every site would write
 * `em.getReference(Tenant, tenantKey as never)` to satisfy the type checker.
 *
 * `getRef` does that one cast internally and returns a typed reference. The caller
 * passes the raw PK; the helper applies the brand.
 */
import type { EntityManager, EntityName, Primary } from '@mikro-orm/core';

export function getRef<T extends object>(
  em: EntityManager,
  entity: EntityName<T>,
  id: number,
): T {
  return em.getReference(entity, id as Primary<T>);
}
