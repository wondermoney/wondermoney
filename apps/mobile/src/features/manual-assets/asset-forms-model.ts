import {
  manualAssetCreateWriteSchema,
  manualAssetValuationWriteSchema,
  type ManualAssetCreateWrite,
  type ManualAssetKind,
  type ManualAssetValuationWrite,
} from './manual-assets-contract'

/** Amounts arrive as wire decimals ("1234.5", "" when empty, "invalid" when unreadable). */
export type ManualAssetCreateDraft = Readonly<{
  name: string
  kind: ManualAssetKind | null
  currencyId: number | null
  value: string
  valuationDate: string
  purchasePrice: string
  purchaseDate: string
  growthRatePercent: string
  isPrivate: boolean
  notes: string
}>

export type ManualAssetCreateField = 'name' | 'kind' | 'currencyId' | 'value' | 'valuationDate' | 'purchasePrice' | 'purchaseDate' | 'growthRatePercent'

export type FormResult<Payload, Field extends string> =
  | { success: true; payload: Payload }
  | { success: false; invalidFields: ReadonlySet<Field> }

const ZOD_TO_FIELD: Record<string, ManualAssetCreateField> = {
  currencyKey: 'currencyId',
  growthRule: 'growthRatePercent',
  kind: 'kind',
  name: 'name',
  purchaseDate: 'purchaseDate',
  purchasePrice: 'purchasePrice',
  valuationDate: 'valuationDate',
  value: 'value',
}

const number = (wire: string) => (wire === '' ? undefined : Number(wire))

/**
 * The Add asset payload, or every field that is wrong in one pass. An unreadable amount is an
 * error, never another number; an empty optional field is left out.
 */
export function buildManualAssetCreatePayload(draft: ManualAssetCreateDraft): FormResult<ManualAssetCreateWrite, ManualAssetCreateField> {
  const invalidFields = new Set<ManualAssetCreateField>()
  if (!draft.kind) invalidFields.add('kind')
  if (draft.currencyId === null) invalidFields.add('currencyId')
  if (draft.value === '') invalidFields.add('value')
  const payload: ManualAssetCreateWrite = {
    name: draft.name.trim(),
    kind: draft.kind ?? 'other',
    currencyKey: draft.currencyId ?? 0,
    value: number(draft.value) ?? Number.NaN,
    valuationDate: draft.valuationDate,
    isPrivate: draft.isPrivate,
  }
  const purchasePrice = number(draft.purchasePrice)
  if (purchasePrice !== undefined) payload.purchasePrice = purchasePrice
  if (draft.purchaseDate) payload.purchaseDate = draft.purchaseDate
  const rate = number(draft.growthRatePercent)
  if (rate !== undefined) payload.growthRule = { annualRatePercent: rate }
  const notes = draft.notes.trim()
  if (notes) payload.notes = notes

  const parsed = manualAssetCreateWriteSchema.safeParse(payload)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = typeof issue.path[0] === 'string' ? ZOD_TO_FIELD[issue.path[0]] : undefined
      if (field) invalidFields.add(field)
    }
  }
  if (invalidFields.size > 0 || !parsed.success) return { success: false, invalidFields }
  return { success: true, payload: parsed.data }
}

export type ValuationDraft = Readonly<{ value: string; date: string; note: string }>
export type ValuationField = 'value' | 'date'

/** "Update value": a value on a day, with an optional note. */
export function buildValuationPayload(draft: ValuationDraft): FormResult<ManualAssetValuationWrite, ValuationField> {
  const invalidFields = new Set<ValuationField>()
  if (draft.value === '') invalidFields.add('value')
  const payload: ManualAssetValuationWrite = { value: number(draft.value) ?? Number.NaN, date: draft.date }
  const note = draft.note.trim()
  if (note) payload.note = note
  const parsed = manualAssetValuationWriteSchema.safeParse(payload)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'value') invalidFields.add('value')
      if (issue.path[0] === 'date') invalidFields.add('date')
    }
  }
  if (invalidFields.size > 0 || !parsed.success) return { success: false, invalidFields }
  return { success: true, payload: parsed.data }
}
