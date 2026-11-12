import { createImageAuthorization } from './image-authorization'

const available = (accessToken: string) => Promise.resolve({ status: 'available' as const, snapshot: { accessToken, tokenGeneration: 1 } })

describe('createImageAuthorization', () => {
  it('reads the token once for a list of images and formats it as a bearer header', async () => {
    const getTokenSnapshot = jest.fn(() => available('token-a'))
    let now = 1_000
    const authorize = createImageAuthorization(getTokenSnapshot, () => now)
    await expect(Promise.all([authorize(), authorize(), authorize()])).resolves.toEqual(['Bearer token-a', 'Bearer token-a', 'Bearer token-a'])
    expect(getTokenSnapshot).toHaveBeenCalledTimes(1)

    now += 31_000
    getTokenSnapshot.mockImplementation(() => available('token-b'))
    await expect(authorize()).resolves.toBe('Bearer token-b')
    expect(getTokenSnapshot).toHaveBeenCalledTimes(2)
  })

  it('is null without a session, and asks again next time', async () => {
    const getTokenSnapshot = jest.fn()
      .mockResolvedValueOnce({ status: 'unavailable' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => available('token-c'))
    const authorize = createImageAuthorization(getTokenSnapshot, () => 0)
    await expect(authorize()).resolves.toBeNull()
    await expect(authorize()).resolves.toBeNull()
    await expect(authorize()).resolves.toBe('Bearer token-c')
  })
})
