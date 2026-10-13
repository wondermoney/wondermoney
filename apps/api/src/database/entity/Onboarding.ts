import { Entity, EntityRepositoryType, PrimaryKey, Property, Unique } from '@mikro-orm/core';

import { OnboardingRepository } from '../repositories/OnboardingRepository';

@Entity({ repository: () => OnboardingRepository })
export class Onboarding {
  @Property({ default: true })
  active = true;

  @Property()
  description!: string;

  [EntityRepositoryType]: OnboardingRepository;

  @PrimaryKey()
  onboardingKey!: number;

  @Property()
  @Unique()
  step!: number;
}
