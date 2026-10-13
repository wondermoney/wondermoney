import {
  buildFeedbackMailDestination,
  buildSupportMailDestination,
  externalDestinations,
  isApprovedExternalDestination,
} from './link-policy'

describe('More exact destination policy', () => {
  it('accepts only the canonical production privacy and terms URLs', () => {
    expect(isApprovedExternalDestination(externalDestinations.privacy)).toBe(true)
    expect(isApprovedExternalDestination(externalDestinations.terms)).toBe(true)
  })

  it.each([
    'http://docs.wonder.money/about/privacy-policy',
    'https://user:pass@docs.wonder.money/about/privacy-policy',
    'https://docs.wonder.money.evil.test/about/privacy-policy',
    'https://evil.docs.wonder.money/about/privacy-policy',
    'https://docs.wonder.money:444/about/privacy-policy',
    'https://docs.wonder.money:443/about/privacy-policy',
    'https://docs.wonder.money/about/privacy-policy/',
    'https://docs.wonder.money/about/privacy-policy?next=evil',
    'https://docs.wonder.money/about/privacy-policy#section',
    'https://docs.wonder.money/about/other',
    'not a url',
  ])('rejects hostile or non-exact destination %s', (candidate) => {
    expect(isApprovedExternalDestination(candidate)).toBe(false)
  })

  it('builds support mail only from fixed recipient and approved display fields', () => {
    const destination = buildSupportMailDestination({ version: '1.0.0', environment: 'staging' })
    expect(destination).toBe(
      'mailto:support@wonder.money?subject=WonderMoney%20support&body=App%20version%3A%201.0.0%0AEnvironment%3A%20staging',
    )
    expect(destination).not.toMatch(/token|account|device|api|supabase|user/i)
    expect(buildSupportMailDestination({ version: 'bad value', environment: 'staging' })).toBeNull()
    expect(buildSupportMailDestination({ version: '1.0.0', environment: 'production' as never })).toBeNull()
  })

  it('builds feedback mail with the category and message, alongside the approved version/environment', () => {
    const destination = buildFeedbackMailDestination(
      { version: '1.0.0', environment: 'staging' },
      { category: 'bug', message: 'The app crashes on launch' },
    )
    expect(destination).toBe(
      'mailto:support@wonder.money?subject=WonderMoney%20feedback%3A%20Bug'
      + '&body=Category%3A%20Bug%0A%0AThe%20app%20crashes%20on%20launch%0A%0AApp%20version%3A%201.0.0%0AEnvironment%3A%20staging',
    )
    expect(destination).not.toMatch(/token|account|device|api|supabase|user|email/i)
  })

  it.each(['bug', 'feature_request', 'other'] as const)('labels the %s category in the subject', (category) => {
    const destination = buildFeedbackMailDestination({ version: '1.0.0', environment: 'local' }, { category, message: 'x' })
    expect(destination).toContain('subject=WonderMoney%20feedback')
  })

  it('trims the message and rejects an empty one', () => {
    const trimmed = buildFeedbackMailDestination({ version: '1.0.0', environment: 'local' }, { category: 'other', message: '  hi  ' })
    expect(trimmed).toContain(encodeURIComponent('hi'))
    expect(buildFeedbackMailDestination({ version: '1.0.0', environment: 'local' }, { category: 'other', message: '   ' })).toBeNull()
  })

  it('rejects an unapproved version or environment, same as support mail', () => {
    expect(buildFeedbackMailDestination({ version: 'bad value', environment: 'staging' }, { category: 'bug', message: 'x' })).toBeNull()
    expect(buildFeedbackMailDestination({ version: '1.0.0', environment: 'production' as never }, { category: 'bug', message: 'x' })).toBeNull()
  })
})
