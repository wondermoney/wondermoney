import { Collection, EntityRepositoryType } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToMany, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { AppuserRepository } from '../repositories/AppuserRepository';

import { AppuserOnboarding } from './AppuserOnboarding';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { Onboarding } from './Onboarding';

export enum AppuserAccountType {
  ADMIN = 'admin',
  DEMO = 'demo',
  REGULAR = 'regular',
}

export enum SupportedLanguages {
  EN = 'EN',
  PT = 'PT',
}
@Entity({ repository: () => AppuserRepository })
export class Appuser extends Base {
  @Enum(() => AppuserAccountType)
  accountType: AppuserAccountType = AppuserAccountType.REGULAR;

  @PrimaryKey()
  @Unique({ name: 'appuser_appuserkey_uindex' })
  appuserKey!: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key', nullable: false })
  currencyKey!: Rel<Currency>;

  @Index()
  @Property({ length: 255 })
  @Unique({ name: 'appuser_emailaddress_uindex' })
  emailAddress!: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  emailAuthenticated?: Date;

  [EntityRepositoryType]: AppuserRepository;

  @Property()
  externalUserId!: string;

  @Property({ length: 255, nullable: true })
  firstName?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  isObfuscated?: Date;

  @Enum()
  language: SupportedLanguages = SupportedLanguages.EN;

  @Property({ length: 255, nullable: true })
  lastName?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  marketingOptIn?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  marketingOptOut?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  mobileAuthenticated?: Date;

  @Property({ length: 20, nullable: true })
  mobileNumber?: string;

  @Property({ length: 10, nullable: true })
  mobileNumberPrefix?: string;

  @ManyToMany({
    entity: () => Onboarding,
    inverseJoinColumn: 'onboarding_key',
    joinColumn: 'appuser_key',
    pivotEntity: () => AppuserOnboarding,
  })
  onboarding = new Collection<Onboarding>(this);

  @Index()
  @Property({ columnType: 'timestamptz', nullable: true })
  onboardingCompletedAt?: Date;

  @Property({ columnType: 'int', nullable: true })
  onboardingCompletedVersion?: number;

  @Property()
  recordActive = true;
}
