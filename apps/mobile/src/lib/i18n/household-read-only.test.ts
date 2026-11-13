import { initMobileI18n } from './index'
import en from './resources/en.json'

/*
 * A household viewer's shared writes answer 403 `household_read_only` (ApiError
 * `household-read-only`). Each write's failure map words it with the one shared
 * view-only message, so every map that words the demo's refusal words this one too.
 */
// Personal writes and accepting an invite elsewhere stay open to a viewer.
const PERSONAL = new Set(['profileEdit.errors', 'security.errors', 'onboarding.completeFailure', 'household.joinExisting.failures'])

const failureMaps = (value: unknown, prefix = ''): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  const own = typeof record.demo === 'string' ? [prefix] : []
  return [...own, ...Object.entries(record).flatMap(([key, child]) => failureMaps(child, prefix ? `${prefix}.${key}` : key))]
}

describe('household view-only copy', () => {
  const maps = failureMaps(en).filter((path) => !PERSONAL.has(path))

  it('words the view-only refusal wherever a write words the demo refusal', () => {
    const missing = maps.filter((path) => {
      const map = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], en) as Record<string, unknown>
      return typeof map['read-only'] !== 'string'
    })
    expect(missing).toEqual([])
  })

  it.each(['en', 'es', 'pt-PT'] as const)('resolves to a real message in %s', async (locale) => {
    const i18n = await initMobileI18n(locale)
    const shared = i18n.t('common.householdReadOnly')
    expect(shared).not.toBe('common.householdReadOnly')
    for (const path of maps.filter((candidate) => !candidate.startsWith('household.'))) {
      expect(i18n.t(`${path}.read-only`)).toBe(shared)
    }
  })
})
