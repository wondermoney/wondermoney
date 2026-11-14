import {
  installmentCommitmentsKey,
  installmentPlanDetailKey,
  installmentPlansKey,
  installmentPlansRootKey,
  installmentSuggestionsKey,
} from './query-keys'

describe('installment plan query keys', () => {
  it('scopes every read under one root per session epoch', () => {
    const root = installmentPlansRootKey(3)
    for (const key of [installmentPlansKey(3, 7), installmentCommitmentsKey(3, 7), installmentSuggestionsKey(3, 7), installmentPlanDetailKey(3, 11)]) {
      expect(key.slice(0, root.length)).toEqual(root)
    }
    expect(installmentPlansKey(3, 7)).not.toEqual(installmentPlansKey(4, 7))
    expect(installmentPlanDetailKey(3, 11)).toEqual(['installment-plans', 3, 'detail', 11])
  })
})
