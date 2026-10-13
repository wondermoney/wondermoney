import type { BankConnectionDto, ConnectionStatus } from './connection-status-contract'

/**
 * Per-row content the screen renders. Same keys the contract returns;
 * nothing is added. The view-model layer is the only place we are allowed
 * to project a DTO into a render shape.
 *
 * RAD-501 — `connectionId` is normalized to `null` whenever the contract's
 * optional/nullable field is absent. Confirmed (see connection-status-contract.ts)
 * that the real API never sends this field at all, so it is always `null` in
 * practice today — this keeps the screen's "can this row be disconnected?"
 * check a single `!== null` comparison instead of juggling `null | undefined`.
 *
 * `provider` widened to `'GoCardless' | 'EnableBanking'` to match the
 * contract now that Enable Banking connections appear in this list too.
 */
export type BankConnectionRow = Readonly<{
  accessType: 'open_banking'
  connectionId: null | number
  dataFreshAsOf: null | string
  expiresAt: null | string
  institutionName: null | string
  provider: 'EnableBanking' | 'GoCardless'
  status: ConnectionStatus
}>

function asRow(dto: BankConnectionDto): BankConnectionRow {
  return {
    accessType: dto.accessType,
    connectionId: dto.connectionId ?? null,
    dataFreshAsOf: dto.dataFreshAsOf,
    expiresAt: dto.expiresAt,
    institutionName: dto.institutionName,
    provider: dto.provider,
    status: dto.status,
  }
}

export function mapBankConnections(dtos: readonly BankConnectionDto[]): readonly BankConnectionRow[] {
  return dtos.map(asRow)
}
