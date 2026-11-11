import { formatBuild, formatVersionInfo } from './version-info'

describe('More version information', () => {
  it('shows the commit beside the version when it has one', () => {
    expect(formatBuild({ version: '1.2.0', commit: 'abc1234' })).toBe('1.2.0 (abc1234)')
    expect(formatBuild({ version: 'dev', commit: null })).toBe('dev')
  })

  it('puts the app and the connected server on one bug-report line', () => {
    expect(formatVersionInfo({
      app: { version: '1.0.0', commit: null },
      server: { version: '1.2.0', commit: 'def5678' },
    })).toBe('WonderMoney app 1.0.0, server 1.2.0 (def5678)')
  })

  it('says when the server version is unknown', () => {
    expect(formatVersionInfo({
      app: { version: '1.0.0', commit: null },
      server: null,
    })).toBe('WonderMoney app 1.0.0, server unknown')
  })
})
