import { createSignInNonce, createSignInState, type NonceCryptoPort } from './sign-in-nonce'

const crypto = (): NonceCryptoPort & { randomBytes: jest.Mock; sha256Hex: jest.Mock } => ({
  randomBytes: jest.fn(async (byteCount: number) => Uint8Array.from({ length: byteCount }, (_, index) => index)),
  sha256Hex: jest.fn(async (value: string) => `sha256(${value})`),
})

describe('createSignInNonce', () => {
  it('draws 32 random bytes and hashes the raw nonce for the provider', async () => {
    const port = crypto()

    const nonce = await createSignInNonce(port)

    expect(port.randomBytes).toHaveBeenCalledWith(32)
    expect(nonce.raw).toHaveLength(64)
    expect(nonce.raw).toMatch(/^[0-9a-f]{64}$/)
    expect(nonce.hashed).toBe(`sha256(${nonce.raw})`)
    expect(port.sha256Hex).toHaveBeenCalledWith(nonce.raw)
  })

  it('never reuses a nonce between attempts', async () => {
    let seed = 0
    const port = crypto()
    port.randomBytes.mockImplementation(async (byteCount: number) => {
      seed += 1
      return Uint8Array.from({ length: byteCount }, (_, index) => (index + seed) % 256)
    })

    const first = await createSignInNonce(port)
    const second = await createSignInNonce(port)

    expect(first.raw).not.toBe(second.raw)
  })
})

describe('createSignInState', () => {
  it('draws an unhashed opaque value for Apple to echo back', async () => {
    const port = crypto()

    const state = await createSignInState(port)

    expect(state).toMatch(/^[0-9a-f]{64}$/)
    expect(port.sha256Hex).not.toHaveBeenCalled()
  })
})
