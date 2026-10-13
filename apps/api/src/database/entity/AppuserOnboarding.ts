import { Entity, ManyToOne, PrimaryKeyProp } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { Appuser } from './Appuser';
import { Onboarding } from './Onboarding';

@Entity()
export class AppuserOnboarding {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key', primary: true })
  appuserKey: Rel<Appuser>;

  @ManyToOne({ cascade: [], entity: () => Onboarding, fieldName: 'onboarding_key', primary: true })
  onboardingKey: Rel<Onboarding>;

  [PrimaryKeyProp]?: [number, number];
}
