import { type AnyEntity, EntityManager, EntityRepository } from '@mikro-orm/postgresql';

export class ExtendedEntityRepository<T extends object> extends EntityRepository<T> {
  async flush(): Promise<void> {
    return this.em.flush();
  }

  persist(entity: AnyEntity | AnyEntity[]): EntityManager {
    return this.em.persist(entity);
  }

  remove(entity: AnyEntity): EntityManager {
    return this.em.remove(entity);
  }
}
