/** Every installment-plan read shares this root, so one write can refresh them all. */
export const installmentPlansRootKey = (epochId: number) => ['installment-plans', epochId] as const
export const installmentPlansKey = (epochId: number, accountId: number) => (
  [...installmentPlansRootKey(epochId), 'list', accountId] as const
)
export const installmentCommitmentsKey = (epochId: number, accountId: number) => (
  [...installmentPlansRootKey(epochId), 'commitments', accountId] as const
)
export const installmentSuggestionsKey = (epochId: number, accountId: number) => (
  [...installmentPlansRootKey(epochId), 'suggestions', accountId] as const
)
export const installmentPlanDetailKey = (epochId: number, planId: number) => (
  [...installmentPlansRootKey(epochId), 'detail', planId] as const
)
