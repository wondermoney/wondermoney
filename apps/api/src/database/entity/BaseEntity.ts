import { Property } from '@mikro-orm/core';

export abstract class Base {
  @Property({ columnType: 'timestamptz', onCreate: () => new Date() })
  createdAt = new Date();

  @Property({ columnType: 'timestamptz', nullable: true })
  deletedAt?: Date;

  @Property({ columnType: 'timestamptz', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt = new Date();
}
