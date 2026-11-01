import type { BankConnectionDto, ConnectionStatus } from './connection-status-contract'

/**
 * Per-row content the screen renders. Same keys the contract returns;
 * nothing is added. The view-model layer is the only place we are allowed
 * to project a DTO into a render shape.
 *
 * `connectionId` is normalized to `null` whenever the contract's
 * optional/nullable field is absent. The real API never sends this field
 * (see connection-status-contract.ts), so it is always `null` in practice —
 * this keeps the screen's "can this row be disconnected?" check a single
 * `!== null` comparison instead of juggling `null | undefined`.
 */
export type BankConnectionRow = Readonly<{
  accessType: BankConnectionDto['accessType']
  connectionId: null | number
  dataFreshAsOf: null | string
  expiresAt: null | string
  institutionName: null | string
  provider: BankConnectionDto['provider']
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
