import { createDisabledTelemetry, telemetry } from './telemetry'

describe('disabled telemetry boundary', () => {
  it('accepts only Foundation lifecycle diagnostics and returns synchronously', () => {
    expect(telemetry.capture('foundation_started')).toBeUndefined()
    expect(telemetry.screen('foundation_bootstrap')).toBeUndefined()

    // @ts-expect-error arbitrary event names are not part of the closed Foundation allowlist
    telemetry.capture('account_opened')
    // @ts-expect-error arbitrary screen names are not part of the closed Foundation allowlist
    telemetry.screen('bank_account_details')
    // @ts-expect-error telemetry never accepts event properties
    telemetry.capture('foundation_ready', { accountId: 'account_1' })
    // @ts-expect-error telemetry never accepts screen properties
    telemetry.screen('foundation_bootstrap', { url: '/accounts/account_1' })
  })

  it('never invokes an injected transport', () => {
    const transport = jest.fn()
    const disabledTelemetry = createDisabledTelemetry({ transport })

    disabledTelemetry.capture('foundation_started')
    disabledTelemetry.capture('foundation_ready')
    disabledTelemetry.screen('foundation_bootstrap')

    expect(transport).not.toHaveBeenCalled()
  })

  it('has no identity, storage, context, queue, or persistence surface', () => {
    expect(Object.keys(telemetry).sort()).toEqual(['capture', 'screen'])
    expect(telemetry).not.toHaveProperty('identify')
    expect(telemetry).not.toHaveProperty('reset')
    expect(telemetry).not.toHaveProperty('group')
    expect(telemetry).not.toHaveProperty('identity')
    expect(telemetry).not.toHaveProperty('storage')
    expect(telemetry).not.toHaveProperty('context')
    expect(telemetry).not.toHaveProperty('queue')
    expect(telemetry).not.toHaveProperty('persistence')
  })
})
