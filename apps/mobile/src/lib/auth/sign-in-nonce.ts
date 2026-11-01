import * as Crypto from 'expo-crypto'

/**
 * A single-use nonce pair for one native ID-token sign-in attempt.
 *
 * `hashed` is what the identity provider receives: both Apple and Google copy it
 * verbatim into the ID token's `nonce` claim. The API then checks that claim against
 * the nonce it is given: Apple's verifier takes `raw` and hashes it, Google's compares
 * `hashed` exactly. Either way a token minted for a different attempt (a replay) fails.
 *
 * Neither half is ever logged, persisted, or included in an error message.
 */
export type SignInNonce = Readonly<{ raw: string; hashed: string }>

export type NonceCryptoPort = Readonly<{
  randomBytes: (byteCount: number) => Promise<Uint8Array>
  /** Lowercase hex SHA-256 digest — the encoding the API compares against. */
  sha256Hex: (value: string) => Promise<string>
}>

const expoNonceCrypto: NonceCryptoPort = {
  randomBytes: (byteCount) => Crypto.getRandomBytesAsync(byteCount),
  sha256Hex: (value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, {
    encoding: Crypto.CryptoEncoding.HEX,
  }),
}

const NONCE_BYTES = 32

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

export async function createSignInNonce(crypto: NonceCryptoPort = expoNonceCrypto): Promise<SignInNonce> {
  const raw = toHex(await crypto.randomBytes(NONCE_BYTES))
  return { raw, hashed: await crypto.sha256Hex(raw) }
}

/**
 * An opaque per-attempt `state` value. Apple echoes it back on the credential unchanged,
 * so a response that does not carry the exact value we just sent did not come from the
 * request we made. Never logged.
 */
export async function createSignInState(crypto: NonceCryptoPort = expoNonceCrypto): Promise<string> {
  return toHex(await crypto.randomBytes(NONCE_BYTES))
}
