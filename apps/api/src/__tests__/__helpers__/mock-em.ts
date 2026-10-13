/**
 * Typed MikroORM `EntityManager` mock builder for tests.
 *
 * Replaces `em as never` hand-rolled mocks with a `mockEm()` that returns
 * `DeepMockProxy<EntityManager>` from `vitest-mock-extended`. Test files keep
 * full type narrowing of the EM surface; no `as never` needed.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import { mockDeep } from 'vitest-mock-extended';

export function mockEm(): EntityManager {
  return mockDeep<EntityManager>();
}
