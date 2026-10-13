import type { Loaded } from '@mikro-orm/core';

import { Onboarding } from '@entity/Onboarding';

import { Appuser, SupportedLanguages } from '../entity/Appuser';
import { Currency } from '../entity/Currency';

import { ExtendedEntityRepository } from './_ExtendedEntityRepository';

export class AppuserRepository extends ExtendedEntityRepository<Appuser> {
  public addOnboardingStep = async (appUser: Loaded<Appuser, 'onboarding'>, onboarding: Onboarding) => {
    const currentOnboarding = appUser.onboarding.getItems();
    if (currentOnboarding.includes(onboarding)) return;
    appUser.onboarding.add(onboarding);
    return this.persist(appUser).flush();
  };
  public createUser = async ({
    email,
    externalUserId,
    firstName,
    language = SupportedLanguages.EN,
    lastName,
    receiveUpdates,
  }: {
    email: Appuser['emailAddress'];
    externalUserId: Appuser['externalUserId'];
    firstName?: Appuser['firstName'];
    language?: Appuser['language'];
    lastName?: Appuser['lastName'];
    receiveUpdates?: boolean;
  }) => {
    // Normalize email to lowercase for consistency
    const normalizedEmail = email.toLowerCase().trim();
    const firstNameActual = firstName ?? normalizedEmail.split('@')[0] ?? 'User';
    const user = new Appuser();
    user.emailAddress = normalizedEmail;
    user.externalUserId = externalUserId;
    user.firstName = firstNameActual;
    const defaultCurrency = await this.em.findOneOrFail(Currency, { code: 'EUR' });
    user.currencyKey = defaultCurrency;
    user.language = language;
    if (lastName) user.lastName = lastName;
    if (receiveUpdates) user.marketingOptIn = new Date();
    const onboardingFirstStep = await this.em.findOne(Onboarding, { step: 1 });
    if (onboardingFirstStep) {
      user.onboarding.add(onboardingFirstStep);
    }
    await this.persist(user).flush();
    return user;
  };
  public getUserByEmail = (email: Appuser['emailAddress']) => {
    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = email.toLowerCase().trim();
    return this.findOne({ deletedAt: undefined, emailAddress: normalizedEmail, recordActive: true });
  };
  public getUserByExternalId = (externalUserId: Appuser['externalUserId']) => {
    return this.findOne({ deletedAt: undefined, externalUserId, recordActive: true });
  };
  public getUserById = (appuserKey: Appuser['appuserKey']) => {
    return this.findOne({ appuserKey, deletedAt: undefined, recordActive: true });
  };
}
