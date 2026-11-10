import {
  preferencesEndpoint,
  updatePreferencesEndpoint,
  userPreferencesSchema,
} from './preview-features-contract'

describe('preview features contract', () => {
  it('reads and writes the same self-scoped endpoint path', () => {
    expect(preferencesEndpoint.method).toBe('GET')
    expect(preferencesEndpoint.path).toBe('/v1/user/me/preferences')
    expect(updatePreferencesEndpoint.method).toBe('PATCH')
    expect(updatePreferencesEndpoint.path).toBe('/v1/user/me/preferences')
  })

  it('accepts the document the API returns', () => {
    expect(userPreferencesSchema.parse({ previewFeatures: true })).toEqual({ previewFeatures: true })
    expect(userPreferencesSchema.parse({ previewFeatures: false })).toEqual({ previewFeatures: false })
  })

  it('strips keys a newer API adds', () => {
    expect(userPreferencesSchema.parse({ previewFeatures: true, futureToggle: 'on' })).toEqual({ previewFeatures: true })
  })

  it('rejects a non-boolean flag', () => {
    expect(userPreferencesSchema.safeParse({ previewFeatures: 'yes' }).success).toBe(false)
    expect(userPreferencesSchema.safeParse({}).success).toBe(false)
  })
})
