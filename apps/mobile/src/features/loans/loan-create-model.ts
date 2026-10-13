import { percentToBasisPoints } from '@/lib/formatters/interest-rate'
import { loanCreateWriteSchema, type LoanCreateWrite, type LoanType } from './loans-contract'

export type LoanCreateDraft = Readonly<{
  name: string
  type: LoanType | null
  currencyId: number | null
  openingPrincipalBalance: string
  openingBalanceDate: string
  providerName?: string
  regularPaymentAmount?: string
  annualInterestRateBps?: string
  termMonths?: string
  includeInNetWorth: boolean
  notes?: string
}>

/** UI field names, used to key per-field error state — not the same set as
 * the zod schema's keys (`type`/`currencyId` here vs. `currencyKey` there). */
export type LoanCreateField = 'name' | 'type' | 'currencyId' | 'openingPrincipalBalance' | 'openingBalanceDate'

export type LoanCreateResult =
  | { success: true; payload: LoanCreateWrite }
  | { success: false; invalidFields: ReadonlySet<LoanCreateField> }

const ZOD_FIELD_TO_UI_FIELD: Record<string, LoanCreateField> = {
  currencyKey: 'currencyId',
  name: 'name',
  openingBalanceDate: 'openingBalanceDate',
  openingPrincipalBalance: 'openingPrincipalBalance',
  type: 'type',
}

export function buildLoanCreatePayload(draft: LoanCreateDraft): LoanCreateResult {
  // Collected up front rather than returned early, so a missing type/currency
  // doesn't short-circuit past validating the rest of the form — every
  // invalid field should get its own inline error in one pass, not one at a
  // time across repeated submits.
  const invalidFields = new Set<LoanCreateField>()
  if (!draft.type) invalidFields.add('type')
  if (draft.currencyId === null) invalidFields.add('currencyId')

  const payload: LoanCreateWrite = {
    name: draft.name.trim(),
    // A placeholder when unset — schema validation still runs on the rest of
    // the payload below, and the real absence is already recorded above.
    type: (draft.type ?? 'OTHER') as LoanType,
    currencyKey: draft.currencyId ?? 0,
    openingPrincipalBalance: Number(draft.openingPrincipalBalance),
    openingBalanceDate: draft.openingBalanceDate.trim(),
    includeInNetWorth: draft.includeInNetWorth,
  }

  const providerName = draft.providerName?.trim()
  if (providerName) payload.providerName = providerName
  const regularPaymentAmount = draft.regularPaymentAmount?.trim()
  if (regularPaymentAmount) payload.regularPaymentAmount = Number(regularPaymentAmount)
  const annualInterestRateBps = draft.annualInterestRateBps?.trim()
  // The field is basis points; the form collects a percentage.
  if (annualInterestRateBps) payload.annualInterestRateBps = percentToBasisPoints(Number(annualInterestRateBps))
  const termMonths = draft.termMonths?.trim()
  if (termMonths) payload.termMonths = Number(termMonths)
  const notes = draft.notes?.trim()
  if (notes) payload.notes = notes

  const parsed = loanCreateWriteSchema.safeParse(payload)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const zodField = issue.path[0]
      const uiField = typeof zodField === 'string' ? ZOD_FIELD_TO_UI_FIELD[zodField] : undefined
      if (uiField) invalidFields.add(uiField)
    }
  }

  // A missing type/currency defaults to a placeholder above so the rest of
  // the payload can still be schema-validated in the same pass — zod alone
  // can't tell that placeholder apart from a real, deliberate choice, so the
  // manual checks recorded into `invalidFields` up front are the source of
  // truth for those two fields, not `parsed.success`.
  if (invalidFields.size > 0) return { success: false, invalidFields }
  // Every top-level zod key maps to a UI field above; an empty set here
  // despite a schema failure would mean an issue outside that map, which the
  // generic outcome banner still catches — but that shouldn't happen with
  // `.strict()`.
  return parsed.success ? { success: true, payload: parsed.data } : { success: false, invalidFields }
}
