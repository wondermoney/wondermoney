import { initMobileI18n } from './index'
import en from './resources/en.json'

/*
 * A write on an account shared with the caller to view only answers 403 `account_read_only`
 * (ApiError `account-read-only`, #95). Every write on an account or its transactions words it
 * with the one shared message.
 */
const ACCOUNT_WRITES = [
  'accountEdit.failures',
  'accountEdit.deleteFailures',
  'accountEdit.sharing.failures',
  'accountRecalculate.failures',
  'transactions.reviewResult',
  'transactions.reimbursement.errors',
  'transactionCreate.result',
  'transactionImport.failures',
  'transactionOcr.failures',
  'recurring.actionResult',
  'banking.statementImport.failures',
  'installments.failures',
  'pendingChanges.failure',
]

const node = (path: string) => path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], en) as Record<string, unknown> | undefined

describe('account view-only copy', () => {
  it('words the account view-only refusal on every account and transaction write', () => {
    expect(ACCOUNT_WRITES.filter((path) => typeof node(path)?.['account-read-only'] !== 'string')).toEqual([])
  })

  it.each(['en', 'es', 'pt-PT'] as const)('resolves to a real message in %s', async (locale) => {
    const i18n = await initMobileI18n(locale)
    const shared = i18n.t('common.accountReadOnly')
    expect(shared).not.toBe('common.accountReadOnly')
    for (const path of ACCOUNT_WRITES) expect(i18n.t(`${path}.account-read-only`)).toBe(shared)
  })
})
