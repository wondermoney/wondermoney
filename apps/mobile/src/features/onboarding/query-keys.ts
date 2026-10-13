const onboardingRootKey = (epochId: number) => ['onboarding', epochId] as const

export const onboardingBootstrapKey = (epochId: number) =>
  [...onboardingRootKey(epochId), 'bootstrap'] as const
