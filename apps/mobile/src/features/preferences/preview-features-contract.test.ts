import {
  preferencesEndpoint,
  updatePreferencesEndpoint,
  userPreferencesSchema,
} from './preview-features-contract'

describe('preferences contract', () => {
  it('reads and writes the same self-scoped endpoint path', () => {
    expect(preferencesEndpoint.method).toBe('GET')
    expect(preferencesEndpoint.path).toBe('/v1/user/me/preferences')
    expect(updatePreferencesEndpoint.method).toBe('PATCH')
    expect(updatePreferencesEndpoint.path).toBe('/v1/user/me/preferences')
  })

  it('accepts the document the API returns', () => {
    expect(userPreferencesSchema.parse({ previewFeatures: true })).toEqual({ previewFeatures: true, dashboardLayout: [] })
    expect(userPreferencesSchema.parse({ previewFeatures: false })).toEqual({ previewFeatures: false, dashboardLayout: [] })
  })

  it('accepts a saved home layout in order', () => {
    const dashboardLayout = [
      { id: 'net-worth', hidden: false },
      { id: 'loans', hidden: true },
    ]

    expect(userPreferencesSchema.parse({ previewFeatures: false, dashboardLayout }).dashboardLayout).toEqual(dashboardLayout)
  })

  it('accepts an id this build does not render, so a newer client layout is not lost', () => {
    expect(
      userPreferencesSchema.parse({ previewFeatures: false, dashboardLayout: [{ id: 'insights', hidden: true }] }).dashboardLayout,
    ).toEqual([{ id: 'insights', hidden: true }])
  })

  it('strips keys a newer API adds', () => {
    expect(userPreferencesSchema.parse({ previewFeatures: true, futureToggle: 'on' })).toEqual({ previewFeatures: true, dashboardLayout: [] })
  })

  it('rejects a non-boolean flag or a malformed layout', () => {
    expect(userPreferencesSchema.safeParse({ previewFeatures: 'yes' }).success).toBe(false)
    expect(userPreferencesSchema.safeParse({}).success).toBe(false)
    expect(userPreferencesSchema.safeParse({ previewFeatures: false, dashboardLayout: [{ id: 'loans' }] }).success).toBe(false)
  })
})
