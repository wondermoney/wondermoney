import { getAppDisplayInfo } from './app-display-info'

describe('More app display information', () => {
  it('returns only approved public version and environment labels', () => {
    expect(getAppDisplayInfo({ version: '1.0.0', environment: 'local' })).toEqual({
      version: '1.0.0',
      environment: 'local',
    })
    expect(getAppDisplayInfo({ version: '2.4.1', environment: 'staging' })).toEqual({
      version: '2.4.1',
      environment: 'staging',
    })
  })

  it.each([
    { version: undefined, environment: 'local' },
    { version: '1.0.0 secret', environment: 'local' },
    { version: '1.0.0', environment: 'production' },
    { version: 'https://api.example', environment: 'staging' },
  ])('rejects unavailable or unapproved display input', (input) => {
    expect(getAppDisplayInfo(input)).toBeNull()
  })
})
