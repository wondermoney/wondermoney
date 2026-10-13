import type { BankInstitutionDto } from './institutions-contract'

/**
 * Per-row content the picker renders. Same three keys the contract
 * returns; nothing is added. Mirrors connection-status-view-model's
 * projection-only convention.
 */
export type BankInstitutionRow = Readonly<{
  id: string
  name: string
  logo: string | null
}>

function asRow(dto: BankInstitutionDto): BankInstitutionRow {
  return { id: dto.id, name: dto.name, logo: dto.logo }
}

export function mapBankInstitutions(dtos: readonly BankInstitutionDto[]): readonly BankInstitutionRow[] {
  return dtos.map(asRow)
}

export function filterBankInstitutions(
  rows: readonly BankInstitutionRow[],
  query: string,
): readonly BankInstitutionRow[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return rows
  return rows.filter((row) => row.name.toLowerCase().includes(normalized))
}
