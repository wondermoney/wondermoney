import { EntityRepositoryType } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

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
