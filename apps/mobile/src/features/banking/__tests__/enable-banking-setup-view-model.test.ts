import { ApiError } from '@/lib/api/errors'
import enMessages from '@/lib/i18n/resources/en.json'
import esMessages from '@/lib/i18n/resources/es.json'
import itMessages from '@/lib/i18n/resources/it.json'
import ptMessages from '@/lib/i18n/resources/pt-PT.json'

import {
  classifyEnableBankingSetupFailure,
  ENABLE_BANKING_SETUP_STEP,
  ENABLE_BANKING_SETUP_STEPS,
  enableBankingControlPanelValues,
  enableBankingSetupFailureMessageKey,
  enableBankingSetupStepNumber,
  type EnableBankingSetupFailureReason,
  failureAsksForCode,
  failureNeedsNewCertificate,
  initialEnableBankingSetupStep,
  nextEnableBankingSetupStep,
  normalizeApplicationId,
  pendingCertificateExpiry,
  previousEnableBankingSetupStep,
  sessionTooOldForSetup,
} from '../enable-banking-setup-view-model'

const httpError = (status: number, serverCode?: string) => new ApiError('http', status, serverCode ? { serverCode } : undefined)

const lookup = (messages: unknown, key: string): unknown => key.split('.').reduce<unknown>(
  (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
  messages,
)

describe('Enable Banking setup steps', () => {
  it('keeps the web wizard\'s five steps, in order, under stable ids', () => {
    expect(ENABLE_BANKING_SETUP_STEPS).toEqual(['sign_in', 'create_application', 'activate', 'application_id', 'choose_bank'])
    expect(ENABLE_BANKING_SETUP_STEP).toEqual({
      signIn: 'sign_in',
      createApplication: 'create_application',
      activate: 'activate',
      applicationId: 'application_id',
      chooseBank: 'choose_bank',
    })
  })

  it('numbers the steps from 1 and walks them forwards and back', () => {
    expect(enableBankingSetupStepNumber('sign_in')).toBe(1)
    expect(enableBankingSetupStepNumber('application_id')).toBe(4)
    expect(nextEnableBankingSetupStep('sign_in')).toBe('create_application')
    // Pasting the ID moves on by activating; the bank list is the connect screen's.
    expect(nextEnableBankingSetupStep('application_id')).toBe('application_id')
    expect(previousEnableBankingSetupStep('activate')).toBe('create_application')
    expect(previousEnableBankingSetupStep('sign_in')).toBeNull()
  })

  it('starts at signing in when the person has no key and none waiting', () => {
    expect(initialEnableBankingSetupStep(undefined)).toBe('sign_in')
    expect(initialEnableBankingSetupStep(null)).toBe('sign_in')
    expect(initialEnableBankingSetupStep({ status: 'revoked', pending: null })).toBe('sign_in')
  })

  it('resumes at pasting the application ID from the server\'s pending certificate', () => {
    const pending = { applicationId: null, status: 'pending' as const, pending: { expiresAt: '2026-12-03T10:00:00.000Z' } }
    expect(initialEnableBankingSetupStep(pending)).toBe('application_id')
    expect(pendingCertificateExpiry(pending)).toBe('2026-12-03T10:00:00.000Z')
    // A replacement for an invalid key waits the same way.
    expect(initialEnableBankingSetupStep({ status: 'invalid', pending: { expiresAt: '2026-12-03T10:00:00.000Z' } })).toBe('application_id')
  })

  it('never opens on the bank list, which is the connect screen\'s', () => {
    expect(initialEnableBankingSetupStep({ status: 'active', pending: null })).toBe('sign_in')
    expect(pendingCertificateExpiry({ status: 'active', pending: null })).toBeNull()
  })

  it('asks for a new sign-in before step 1 when the session would go stale during the setup', () => {
    const now = Date.parse('2026-11-26T12:00:00.000Z')
    expect(sessionTooOldForSetup('2026-11-26T11:00:00.000Z', now)).toBe(false)
    expect(sessionTooOldForSetup('2026-11-25T14:00:00.000Z', now)).toBe(false)
    // 23 hours old: still under the server's 24, but the setup could outlast it.
    expect(sessionTooOldForSetup('2026-11-25T13:00:00.000Z', now)).toBe(true)
    expect(sessionTooOldForSetup('2026-11-20T12:00:00.000Z', now)).toBe(true)
    // Unknown reads as fresh: the server still answers session_not_fresh if not.
    expect(sessionTooOldForSetup(null, now)).toBe(false)
    expect(sessionTooOldForSetup('not a date', now)).toBe(false)
  })

  it('lists the Control Panel values in the form\'s order, from the server', () => {
    expect(enableBankingControlPanelValues(null)).toEqual([])
    expect(enableBankingControlPanelValues({
      applicationDescription: 'Personal use: reads my own bank accounts into WonderMoney.',
      applicationName: 'WonderMoney',
      privacyUrl: 'https://docs.example.test/privacy',
      redirectUrl: 'https://api.example.test/v1/banking/enable-banking/callback',
      termsUrl: 'https://docs.example.test/terms',
    })).toEqual([
      { field: 'name', value: 'WonderMoney' },
      { field: 'description', value: 'Personal use: reads my own bank accounts into WonderMoney.' },
      { field: 'redirectUrl', value: 'https://api.example.test/v1/banking/enable-banking/callback' },
      { field: 'privacyUrl', value: 'https://docs.example.test/privacy' },
      { field: 'termsUrl', value: 'https://docs.example.test/terms' },
    ])
  })

  it('drops what a paste brings along from an application ID', () => {
    expect(normalizeApplicationId('  6b1b3c2a-4e9d-4f2a-9c1b-1234567890ab\n')).toBe('6b1b3c2a-4e9d-4f2a-9c1b-1234567890ab')
  })
})

describe('classifyEnableBankingSetupFailure', () => {
  it.each([
    ['enable_banking_application_not_found', 400, 'application-not-found', 'create_application'],
    ['enable_banking_application_sandbox', 400, 'sandbox', 'create_application'],
    ['enable_banking_application_not_activated', 400, 'not-activated', 'activate'],
    ['enable_banking_credential_refused', 400, 'refused', 'create_application'],
    ['enable_banking_pending_credential_missing', 409, 'pending-missing', 'create_application'],
    ['totp_required', 403, 'totp-required', null],
    ['invalid_totp', 403, 'invalid-totp', null],
    ['session_not_fresh', 403, 'session-not-fresh', null],
  ] as const)('%s reads as %s, fixed at step %s', (code, status, reason, revisit) => {
    expect(classifyEnableBankingSetupFailure(httpError(status, code))).toEqual({ reason, revisit })
  })

  it('reads the rest by status and kind', () => {
    expect(classifyEnableBankingSetupFailure(httpError(429))).toEqual({ reason: 'rate-limited', revisit: null })
    expect(classifyEnableBankingSetupFailure(httpError(502))).toEqual({ reason: 'unavailable', revisit: null })
    expect(classifyEnableBankingSetupFailure(httpError(400, 'validation_failed'))).toEqual({ reason: 'general', revisit: null })
    expect(classifyEnableBankingSetupFailure(new ApiError('demo-forbidden', 403))).toEqual({ reason: 'demo', revisit: null })
    expect(classifyEnableBankingSetupFailure(new ApiError('household-read-only', 403))).toEqual({ reason: 'read-only', revisit: null })
    expect(classifyEnableBankingSetupFailure(new ApiError('network'))).toEqual({ reason: 'network', revisit: null })
    expect(classifyEnableBankingSetupFailure(new ApiError('auth-session', 401))).toEqual({ reason: 'general', revisit: null })
    expect(classifyEnableBankingSetupFailure(new Error('boom'))).toEqual({ reason: 'general', revisit: null })
  })

  it('asks for the authenticator code only when the server did, and a new certificate only when the old one is gone', () => {
    expect(failureAsksForCode('totp-required')).toBe(true)
    expect(failureAsksForCode('invalid-totp')).toBe(true)
    expect(failureAsksForCode('session-not-fresh')).toBe(false)
    expect(failureNeedsNewCertificate('pending-missing')).toBe(true)
    expect(failureNeedsNewCertificate('sandbox')).toBe(false)
  })

  const reasons: EnableBankingSetupFailureReason[] = [
    'application-not-found', 'sandbox', 'not-activated', 'refused', 'pending-missing', 'totp-required',
    'invalid-totp', 'session-not-fresh', 'rate-limited', 'demo', 'read-only', 'network', 'unavailable', 'general',
  ]

  it.each([['en', enMessages], ['es', esMessages], ['pt-PT', ptMessages], ['it', itMessages]] as const)(
    'gives every failure its own message in %s',
    (_locale, messages) => {
      const texts = reasons.map((reason) => lookup(messages, enableBankingSetupFailureMessageKey(reason)))
      // The view-only refusal is the app's one shared message (household-read-only.test.ts).
      expect(lookup(messages, enableBankingSetupFailureMessageKey('read-only'))).toBe('$t(common.householdReadOnly)')
      texts.forEach((text) => expect(typeof text).toBe('string'))
      expect(new Set(texts).size).toBe(reasons.length)
    },
  )

  it.each([['es', esMessages], ['pt-PT', ptMessages], ['it', itMessages]] as const)(
    'has every step title in %s',
    (_locale, messages) => {
      for (const step of ENABLE_BANKING_SETUP_STEPS) {
        expect(typeof lookup(messages, `banking.keySetup.steps.${step}`)).toBe('string')
      }
    },
  )
})
