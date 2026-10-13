import { act, renderHook } from '@testing-library/react-native'

import { useMfaChallenge } from './use-mfa-challenge'

const mockMfaListFactors = jest.fn()
const mockMfaChallenge = jest.fn()
const mockMfaVerify = jest.fn()
const mockCompleteMfaVerification = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    mfaListFactors: mockMfaListFactors,
    mfaChallenge: mockMfaChallenge,
    mfaVerify: mockMfaVerify,
    completeMfaVerification: mockCompleteMfaVerification,
  }),
}))

describe('useMfaChallenge', () => {
  beforeEach(() => {
    mockMfaListFactors.mockReset()
    mockMfaChallenge.mockReset()
    mockMfaVerify.mockReset()
    mockCompleteMfaVerification.mockReset()
  })

  it('challenges the verified factor, verifies the code, and completes the step-up', async () => {
    mockMfaListFactors.mockResolvedValue({
      status: 'available',
      totpFactors: [{ id: 'unverified-1', status: 'unverified' }, { id: 'verified-1', status: 'verified' }],
    })
    mockMfaChallenge.mockResolvedValue({ status: 'challenged', challengeId: 'challenge-1' })
    mockMfaVerify.mockResolvedValue({ status: 'verified' })
    const hook = await renderHook(() => useMfaChallenge())

    await act(async () => { await hook.result.current.submit('123456') })

    expect(mockMfaChallenge).toHaveBeenCalledWith('verified-1')
    expect(mockMfaVerify).toHaveBeenCalledWith('verified-1', 'challenge-1', '123456')
    expect(mockCompleteMfaVerification).toHaveBeenCalledTimes(1)
    expect(hook.result.current.failure).toBeNull()
    expect(hook.result.current.submitting).toBe(false)
  })

  it('surfaces an invalid code without completing the step-up', async () => {
    mockMfaListFactors.mockResolvedValue({ status: 'available', totpFactors: [{ id: 'verified-1', status: 'verified' }] })
    mockMfaChallenge.mockResolvedValue({ status: 'challenged', challengeId: 'challenge-1' })
    mockMfaVerify.mockResolvedValue({ status: 'invalid-code' })
    const hook = await renderHook(() => useMfaChallenge())

    await act(async () => { await hook.result.current.submit('000000') })

    expect(hook.result.current.failure).toBe('invalid-code')
    expect(mockCompleteMfaVerification).not.toHaveBeenCalled()
  })

  it('reports unavailable when there is no verified factor', async () => {
    mockMfaListFactors.mockResolvedValue({ status: 'available', totpFactors: [] })
    const hook = await renderHook(() => useMfaChallenge())

    await act(async () => { await hook.result.current.submit('123456') })

    expect(hook.result.current.failure).toBe('unavailable')
    expect(mockMfaChallenge).not.toHaveBeenCalled()
    expect(mockCompleteMfaVerification).not.toHaveBeenCalled()
  })

  it('reports unavailable when listing factors or challenging fails', async () => {
    mockMfaListFactors.mockResolvedValue({ status: 'unavailable' })
    const hook = await renderHook(() => useMfaChallenge())
    await act(async () => { await hook.result.current.submit('123456') })
    expect(hook.result.current.failure).toBe('unavailable')

    mockMfaListFactors.mockResolvedValue({ status: 'available', totpFactors: [{ id: 'f1', status: 'verified' }] })
    mockMfaChallenge.mockResolvedValue({ status: 'unavailable' })
    await act(async () => { await hook.result.current.submit('123456') })
    expect(hook.result.current.failure).toBe('unavailable')
    expect(mockMfaVerify).not.toHaveBeenCalled()
  })

  it('ignores a second submission while one is already in flight', async () => {
    let resolveList!: (value: { status: 'available'; totpFactors: { id: string; status: 'verified' }[] }) => void
    mockMfaListFactors.mockReturnValue(new Promise((resolve) => { resolveList = resolve }))
    mockMfaChallenge.mockResolvedValue({ status: 'challenged', challengeId: 'challenge-1' })
    mockMfaVerify.mockResolvedValue({ status: 'verified' })
    const hook = await renderHook(() => useMfaChallenge())

    let first!: Promise<void>
    await act(() => { first = hook.result.current.submit('111111') })
    await act(() => { void hook.result.current.submit('222222') })
    expect(mockMfaListFactors).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveList({ status: 'available', totpFactors: [{ id: 'f1', status: 'verified' }] })
      await first
    })
  })
})
