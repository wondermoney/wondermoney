import { mapProfile } from './self-view-models'

describe('self view models', () => {
  it('preserves profile nulls and excludes identifiers and raw auth data', () => {
    expect(mapProfile({
      emailAddress: 'person@example.com',
      firstName: null,
      lastName: 'Silva',
      mfaEnabled: false,
    })).toEqual({
      emailAddress: 'person@example.com',
      firstName: null,
      lastName: 'Silva',
      mfaEnabled: false,
    })
  })
})
