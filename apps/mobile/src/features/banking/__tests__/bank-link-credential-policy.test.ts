import { resolveBankLinkCredential } from '../bank-link-credential-policy'

const settled = {
  callerCredentials: 'user' as const,
  callerLoading: false,
  instanceCredentials: 'user' as const,
  ownCredentialActive: false,
  ownCredentialLoading: false,
}

describe('resolveBankLinkCredential', () => {
  it('opens the bank list for a household the server\'s shared credential covers', () => {
    expect(resolveBankLinkCredential({ ...settled, callerCredentials: 'instance', instanceCredentials: 'instance' }))
      .toEqual({ status: 'ready' })
  })

  it('opens the bank list with an active key of the user\'s own, whatever the server offers', () => {
    expect(resolveBankLinkCredential({ ...settled, callerLoading: true, ownCredentialActive: true })).toEqual({ status: 'ready' })
  })

  it('asks for a key when neither is available', () => {
    expect(resolveBankLinkCredential(settled)).toEqual({ sharedUnavailable: false, status: 'credential-required' })
  })

  it('says why a key is still needed when the shared credential serves another household', () => {
    expect(resolveBankLinkCredential({ ...settled, instanceCredentials: 'instance' }))
      .toEqual({ sharedUnavailable: true, status: 'credential-required' })
  })

  it('waits while either answer is loading', () => {
    expect(resolveBankLinkCredential({ ...settled, ownCredentialLoading: true })).toEqual({ status: 'loading' })
    expect(resolveBankLinkCredential({ ...settled, callerLoading: true })).toEqual({ status: 'loading' })
  })

  it('treats an older server without the per-caller answer as needing the user\'s own key', () => {
    expect(resolveBankLinkCredential({ ...settled, callerCredentials: undefined, instanceCredentials: undefined }))
      .toEqual({ sharedUnavailable: false, status: 'credential-required' })
  })
})
