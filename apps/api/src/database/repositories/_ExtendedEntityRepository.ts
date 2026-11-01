import { type AnyEntity, EntityRepository, type SqlEntityManager } from '@mikro-orm/postgresql';

export class ExtendedEntityRepository<T extends object> extends EntityRepository<T> {
  async flush(): Promise<void> {
    return this.em.flush();
  }

  persist(entity: AnyEntity | AnyEntity[]): SqlEntityManager {
    return this.em.persist(entity);
  }

  remove(entity: AnyEntity): SqlEntityManager {
    return this.em.remove(entity);
  }
}
