import { PrimaryKeyProp } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, ManyToOne } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Onboarding } from './Onboarding';

@Entity()
export class AppuserOnboarding {
  @ManyToOne({ cascade: [], deleteRule: 'no action', entity: () => Appuser, fieldName: 'appuser_key', primary: true, updateRule: 'no action' })
  appuserKey: Rel<Appuser>;

  @ManyToOne({ cascade: [], deleteRule: 'no action', entity: () => Onboarding, fieldName: 'onboarding_key', primary: true, updateRule: 'no action' })
  onboardingKey: Rel<Onboarding>;

  [PrimaryKeyProp]?: [number, number];
}
