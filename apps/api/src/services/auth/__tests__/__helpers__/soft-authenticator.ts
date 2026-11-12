import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto';

/**
 * A software WebAuthn authenticator for tests: an ES256 key pair that answers the
 * registration and authentication ceremonies the way a browser plus a platform authenticator
 * would, with real signatures.
 *
 * Nothing on the server is mocked. better-auth's passkey plugin hands the responses to
 * `@simplewebauthn/server`, which checks the challenge, the origin, the relying-party ID hash,
 * the user-presence and user-verification flags and the signature, exactly as it would for a
 * real device. `origin` is the page the "browser" is on, so a test can also play a phishing
 * page by passing another one.
 *
 * Attestation is `none`, the format the plugin asks for, so no certificate chain is needed.
 */

type CborValue = CborValue[] | Map<CborValue, CborValue> | number | string | Uint8Array | { [key: string]: CborValue };

/** Just enough CBOR (RFC 8949) for an attestation object and a COSE key. */
function cbor(value: CborValue): Buffer {
  const head = (major: number, length: number): Buffer => {
    if (length < 24) return Buffer.from([(major << 5) | length]);
    if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
    if (length < 0x10000) return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
    const out = Buffer.alloc(5);
    out[0] = (major << 5) | 26;
    out.writeUInt32BE(length, 1);
    return out;
  };
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const sha256 = (data: string | Uint8Array): Buffer => createHash('sha256').update(data).digest();

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

export interface AuthenticationOptions {
  challenge: string;
  rpId: string;
}

export interface RegistrationOptions {
  challenge: string;
  rp: { id: string };
}

export interface SoftAuthenticator {
  /** Sign an assertion for the options `/passkey/generate-authenticate-options` returned. */
  assert(options: AuthenticationOptions, overrides?: { origin?: string; userVerified?: boolean }): Record<string, unknown>;
  /** The credential id, base64url, as the server stores it. */
  credentialId: string;
  /** Create a credential for the options `/passkey/generate-register-options` returned. */
  register(options: RegistrationOptions): Record<string, unknown>;
}

export function softAuthenticator({ origin }: { origin: string }): SoftAuthenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialIdBytes = randomBytes(32);
  const credentialId = b64url(credentialIdBytes);
  let signCount = 0;

  const coseKey = (key: KeyObject): Buffer => {
    const { x, y } = key.export({ format: 'jwk' });
    if (!x || !y) throw new Error('Expected an EC public key');
    return cbor(new Map<CborValue, CborValue>([
      [-3, Buffer.from(y, 'base64url')], // y
      [-2, Buffer.from(x, 'base64url')], // x
      [-1, 1], // crv: P-256
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
    ]));
  };

  const clientData = (type: string, challenge: string, pageOrigin: string): Buffer =>
    Buffer.from(JSON.stringify({ challenge, crossOrigin: false, origin: pageOrigin, type }), 'utf8');

  const counter = (): Buffer => {
    const out = Buffer.alloc(4);
    out.writeUInt32BE(signCount);
    return out;
  };

  return {
    assert(options, overrides = {}) {
      signCount += 1;
      const flags = FLAG_USER_PRESENT | (overrides.userVerified === false ? 0 : FLAG_USER_VERIFIED);
      const authenticatorData = Buffer.concat([sha256(options.rpId), Buffer.from([flags]), counter()]);
      const clientDataJSON = clientData('webauthn.get', options.challenge, overrides.origin ?? origin);
      const signature = sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), privateKey);
      return {
        clientExtensionResults: {},
        id: credentialId,
        rawId: credentialId,
        response: {
          authenticatorData: b64url(authenticatorData),
          clientDataJSON: b64url(clientDataJSON),
          signature: b64url(signature),
        },
        type: 'public-key',
      };
    },
    credentialId,
    register(options) {
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(credentialIdBytes.length);
      const authData = Buffer.concat([
        sha256(options.rp.id),
        Buffer.from([FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_CREDENTIAL]),
        counter(),
        Buffer.alloc(16), // AAGUID: all zeros, as privacy-preserving platforms report it
        idLength,
        credentialIdBytes,
        coseKey(publicKey),
      ]);
      const attestationObject = cbor({ attStmt: {}, authData, fmt: 'none' });
      return {
        authenticatorAttachment: 'platform',
        clientExtensionResults: {},
        id: credentialId,
        rawId: credentialId,
        response: {
          attestationObject: b64url(attestationObject),
          clientDataJSON: b64url(clientData('webauthn.create', options.challenge, origin)),
          transports: ['internal'],
        },
        type: 'public-key',
      };
    },
  };
}
