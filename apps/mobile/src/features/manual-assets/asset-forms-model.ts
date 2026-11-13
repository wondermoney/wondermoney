import {
  isCryptoWallet,
  manualAssetCreateWriteSchema,
  manualAssetKindSchema,
  manualAssetUpdateWriteSchema,
  manualAssetValuationWriteSchema,
  type ManualAssetCreateWrite,
  type ManualAssetDto,
  type ManualAssetKind,
  type ManualAssetUpdateWrite,
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

/** Edit asset: what the form holds. Amounts arrive as wire decimals, as on Add asset. */
export type ManualAssetEditDraft = Readonly<{
  name: string
  kind: ManualAssetKind
  purchasePrice: string
  purchaseDate: string
  growthRatePercent: string
  growthStartDate: string
  isPrivate: boolean
  notes: string
}>

export type ManualAssetEditField = 'name' | 'purchasePrice' | 'purchaseDate' | 'growthRatePercent' | 'growthStartDate'

export type ManualAssetEditOriginal = Pick<ManualAssetDto, 'name' | 'kind' | 'purchasePrice' | 'purchaseDate' | 'growthRule' | 'isPrivate' | 'isOwner' | 'notes'>

/** The form's starting point: the asset as it is. A kind this build can't write reads as "other". */
export function manualAssetEditDraftOf(asset: ManualAssetEditOriginal, formatNumber: (value: number) => string): ManualAssetEditDraft {
  const kind = manualAssetKindSchema.safeParse(asset.kind)
  return {
    name: asset.name,
    kind: kind.success ? kind.data : 'other',
    purchasePrice: asset.purchasePrice === null ? '' : formatNumber(asset.purchasePrice),
    purchaseDate: asset.purchaseDate ?? '',
    growthRatePercent: asset.growthRule ? formatNumber(asset.growthRule.annualRatePercent) : '',
    growthStartDate: asset.growthRule?.startDate ?? '',
    isPrivate: asset.isPrivate,
    notes: asset.notes ?? '',
  }
}

const sameGrowth = (a: ManualAssetDto['growthRule'], b: ManualAssetDto['growthRule']) => (
  a === null || b === null ? a === b : a.annualRatePercent === b.annualRatePercent && a.startDate === b.startDate
)

/**
 * Edit asset's PATCH: the fields that differ from the asset, or every field that is wrong in one
 * pass. As on the web, a cleared optional field is sent as null, a growth start date counts only
 * with a yearly change, and privacy is left out unless the viewer owns the asset. A crypto wallet
 * changes only its name, notes and privacy: its kind is fixed and its balances value it. `changed` is
 * false when nothing would change, so the form has nothing to save.
 *
 * `draft` holds wire decimals: the screen converts what was typed first (`toWireDecimalInput`).
 */
export function buildManualAssetUpdatePayload(
  original: ManualAssetEditOriginal,
  draft: ManualAssetEditDraft,
): FormResult<ManualAssetUpdateWrite, ManualAssetEditField> | { success: true; payload: null } {
  const invalidFields = new Set<ManualAssetEditField>()
  const name = draft.name.trim()
  if (name === '' || name.length > 255) invalidFields.add('name')
  const purchasePrice = draft.purchasePrice === '' ? null : Number(draft.purchasePrice)
  if (purchasePrice !== null && !(Number.isFinite(purchasePrice) && purchasePrice >= 0)) invalidFields.add('purchasePrice')
  const rate = draft.growthRatePercent === '' ? null : Number(draft.growthRatePercent)
  if (rate !== null && !(Number.isFinite(rate) && rate > -100 && rate <= 1000)) invalidFields.add('growthRatePercent')
  if (invalidFields.size > 0) return { success: false, invalidFields }

  const purchaseDate = draft.purchaseDate || null
  const growthRule = rate === null ? null : { annualRatePercent: rate, startDate: draft.growthStartDate || null }
  const notes = draft.notes.trim() === '' ? null : draft.notes.trim()
  const change: ManualAssetUpdateWrite = {}
  if (name !== original.name) change.name = name
  if (!isCryptoWallet(original)) {
    if (draft.kind !== original.kind) change.kind = draft.kind
    if (purchasePrice !== original.purchasePrice) change.purchasePrice = purchasePrice
    if (purchaseDate !== original.purchaseDate) change.purchaseDate = purchaseDate
    if (!sameGrowth(growthRule, original.growthRule)) change.growthRule = growthRule
  }
  if (original.isOwner && draft.isPrivate !== original.isPrivate) change.isPrivate = draft.isPrivate
  if (notes !== (original.notes?.trim() || null)) change.notes = notes
  if (Object.keys(change).length === 0) return { success: true, payload: null }

  const parsed = manualAssetUpdateWriteSchema.safeParse(change)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (key === 'name' || key === 'purchasePrice' || key === 'purchaseDate') invalidFields.add(key)
      else if (key === 'growthRule') invalidFields.add(issue.path[1] === 'startDate' ? 'growthStartDate' : 'growthRatePercent')
    }
    return { success: false, invalidFields }
  }
  return { success: true, payload: parsed.data }
}
