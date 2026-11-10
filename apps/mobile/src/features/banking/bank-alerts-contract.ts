import { z } from 'zod'

import { readEndpoint, tolerantEnum } from '@/lib/api/runtime-schema'

/**
 * `GET /v1/banking/alerts`: the viewer's own bank connections that need
 * attention (the API leaves out other household members' connections).
 * `id` is opaque and stable for one alert episode, so dismissals key on it and
 * a new episode shows again.
 *
 * An alert `kind` this build doesn't know is dropped rather than failing the
 * list. Dates stay strings and are read in the view model, so one odd
 * timestamp costs that line its date, not the whole banner. An older server
 * answers 404 here; the hook reads every failure as "no alerts".
 */
export const BANK_ALERT_KINDS = ['consent_expiring', 'consent_revoked', 'sync_failing'] as const

export type BankAlertKind = typeof BANK_ALERT_KINDS[number]

const bankAlertSchema = z.object({
  id: z.string().min(1),
  kind: tolerantEnum(BANK_ALERT_KINDS, null),
  institutionName: z.string().nullable().optional(),
  bankId: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  daysUntilExpiry: z.number().int().nonnegative().nullable().optional(),
  failingSince: z.string().nullable().optional(),
})

export type BankAlertDto = Readonly<{
  id: string
  kind: BankAlertKind
  institutionName: string | null
  bankId: string | null
  expiresAt: string | null
  daysUntilExpiry: number | null
  failingSince: string | null
}>

export const bankAlertsResponseSchema = z.object({
  alerts: z.array(bankAlertSchema),
}).transform(({ alerts }): { alerts: readonly BankAlertDto[] } => ({
  alerts: alerts.flatMap((alert) => (alert.kind === null ? [] : [{
    id: alert.id,
    kind: alert.kind,
    institutionName: alert.institutionName ?? null,
    bankId: alert.bankId ?? null,
    expiresAt: alert.expiresAt ?? null,
    daysUntilExpiry: alert.daysUntilExpiry ?? null,
    failingSince: alert.failingSince ?? null,
  }])),
}))

export type BankAlertsResponseDto = z.infer<typeof bankAlertsResponseSchema>

export const bankAlertsEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/banking/alerts',
  schema: bankAlertsResponseSchema,
})
