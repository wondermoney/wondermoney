import { BANK_SYNC_ERROR_ACTION_KEYS, BANK_SYNC_ERROR_CODES, BANK_SYNC_ERROR_COPY } from '@wondermoney/shared/bank-sync'

import en from './resources/en.json'
import es from './resources/es.json'
import ptPT from './resources/pt-PT.json'

type Resource = Record<string, unknown>

function valueAt(resource: Resource, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Resource)[segment]
  }, resource)
}

const resources = { en, es, 'pt-PT': ptPT } as const

describe('bank-sync error copy', () => {
  it('has a message and an action for every code in all three locales', () => {
    for (const code of BANK_SYNC_ERROR_CODES) {
      const copy = BANK_SYNC_ERROR_COPY[code]
      const actionKey = BANK_SYNC_ERROR_ACTION_KEYS[copy.action]

      for (const resource of Object.values(resources)) {
        expect(typeof valueAt(resource as Resource, copy.messageKey)).toBe('string')
        expect((valueAt(resource as Resource, copy.messageKey) as string).trim()).not.toBe('')
        expect(typeof valueAt(resource as Resource, actionKey)).toBe('string')
        expect((valueAt(resource as Resource, actionKey) as string).trim()).not.toBe('')
      }
    }
  })
})
