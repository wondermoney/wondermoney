import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { bech32, bech32m, createBase58check } from '@scure/base';
import { wordlist as bip39English } from '@scure/bip39/wordlists/english.js';
import { looksLikeWalletSecret, phraseWords, SEED_PHRASE_WORD_COUNTS } from '@wondermoney/shared';

import type { CryptoChain } from '@config/crypto-explorers';

/**
 * What a person typed as a wallet address, told apart before anything is stored or sent.
 *
 * Only public addresses are accepted. A secret (a private key or a recovery phrase) is
 * recognised first and refused as such, so the caller can say so without repeating it: the
 * result never carries the input. A near miss is still a secret: a key with a typo fails its
 * checksum but is no less dangerous to keep.
 *
 * Bitcoin (mainnet): P2PKH `1…` and P2SH `3…` in base58check, segwit `bc1q…` (bech32) and
 * taproot `bc1p…` (bech32m), and the account extended public keys `xpub` (P2PKH), `ypub`
 * (P2SH-wrapped segwit) and `zpub` (native segwit). Ethereum: `0x` and 40 hex digits; mixed case
 * must match its EIP-55 checksum, all-lower or all-upper has none to check.
 */
export type AddressKind = 'address' | 'xpub';

/** The script an extended public key's addresses use. */
export type ClassifiedInput =
  | { address: string; kind: 'address'; ok: true }
  | { address: string; kind: 'xpub'; ok: true; script: XpubScript }
  | { ok: false; reason: 'invalid' | 'secret' };

export type XpubScript = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh';

export const base58check = createBase58check(sha256);

/** Version bytes of the account extended public keys, and the script each one's addresses use. */
export const XPUB_VERSIONS: Readonly<Record<'xpub' | 'ypub' | 'zpub', { public: number; script: XpubScript }>> = {
  xpub: { public: 0x04_88_b2_1e, script: 'p2pkh' },
  ypub: { public: 0x04_9d_7c_b2, script: 'p2sh-p2wpkh' },
  zpub: { public: 0x04_b2_47_46, script: 'p2wpkh' },
};

const BIP39_WORDS = new Set(bip39English);
/** A recovery phrase is "mostly" BIP-39 words: a typo or two still makes it one. */
const SEED_WORD_SHARE = 2 / 3;

/** Whether `input` looks like a private key or a recovery phrase. The input is never returned or logged. */
export function isWalletSecret(input: string): boolean {
  if (looksLikeWalletSecret(input) !== null) return true;
  const words = phraseWords(input);
  if (!SEED_PHRASE_WORD_COUNTS.includes(words.length)) return false;
  return words.filter((word) => BIP39_WORDS.has(word)).length >= words.length * SEED_WORD_SHARE;
}

/** Classify an input for a chain: a public address (normalised), an extended public key, a secret, or nothing valid. */
export function classifyWalletInput(chain: CryptoChain, input: string): ClassifiedInput {
  if (isWalletSecret(input)) return { ok: false, reason: 'secret' };
  const value = input.trim();
  if (chain === 'bitcoin') return classifyBitcoin(value);
  const address = normaliseEthereumAddress(value);
  return address ? { address, kind: 'address', ok: true } : { ok: false, reason: 'invalid' };
}

/** The EIP-55 checksummed form of a 20-byte hex address. */
export function eip55(address: string): string {
  const hex = address.replace(/^0x/iu, '').toLowerCase();
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(hex)));
  let out = '0x';
  for (let index = 0; index < hex.length; index += 1) {
    const char = hex.charAt(index);
    out += Number.parseInt(hash.charAt(index), 16) >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

/** A valid Ethereum address in its checksummed form, or null. */
export function normaliseEthereumAddress(value: string): null | string {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) return null;
  const digits = value.slice(2);
  const checksummed = eip55(value);
  const singleCase = digits === digits.toLowerCase() || digits === digits.toUpperCase();
  if (!singleCase && checksummed !== value) return null;
  return checksummed;
}

function classifyBitcoin(value: string): ClassifiedInput {
  const xpub = xpubScript(value);
  if (xpub) return { address: value, kind: 'xpub', ok: true, script: xpub };
  const segwit = segwitAddress(value);
  if (segwit) return { address: segwit, kind: 'address', ok: true };
  if (isBase58Address(value)) return { address: value, kind: 'address', ok: true };
  return { ok: false, reason: 'invalid' };
}

/** A P2PKH (version 0) or P2SH (version 5) mainnet address with a valid checksum. */
function isBase58Address(value: string): boolean {
  if (!/^[13][1-9A-HJ-NP-Za-km-z]{24,33}$/u.test(value)) return false;
  try {
    const payload = base58check.decode(value);
    return payload.length === 21 && (payload[0] === 0x00 || payload[0] === 0x05);
  } catch {
    return false;
  }
}

/** A mainnet segwit address, lower-cased: v0 in bech32 with a 20 or 32 byte program, v1+ in bech32m. */
function decodeSegwit(address: string): null | { program: Uint8Array; version: number } {
  for (const codec of [bech32, bech32m]) {
    try {
      const { prefix, words } = codec.decode(address as `${string}1${string}`);
      if (prefix !== 'bc' || words.length === 0) continue;
      const version = words[0] ?? -1;
      // v0 uses bech32, every later version bech32m (BIP-350).
      if ((version === 0) !== (codec === bech32)) continue;
      return { program: codec.fromWords(words.slice(1)), version };
    } catch {
      // Not this encoding.
    }
  }
  return null;
}

function segwitAddress(value: string): null | string {
  const lower = value.toLowerCase();
  // Bech32 is single-case; mixed case is not an address.
  if (value !== lower && value !== value.toUpperCase()) return null;
  if (!lower.startsWith('bc1')) return null;
  const decoded = decodeSegwit(lower);
  if (!decoded) return null;
  const { program, version } = decoded;
  if (version === 0 && program.length !== 20 && program.length !== 32) return null;
  if (version === 1 && program.length !== 32) return null;
  if (version > 16 || program.length < 2 || program.length > 40) return null;
  return lower;
}

/** The script of a valid account-level xpub/ypub/zpub, or null. */
function xpubScript(value: string): null | XpubScript {
  const prefix = value.slice(0, 4);
  if (prefix !== 'xpub' && prefix !== 'ypub' && prefix !== 'zpub') return null;
  try {
    const payload = base58check.decode(value);
    if (payload.length !== 78) return null;
    const version = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0);
    const expected = XPUB_VERSIONS[prefix];
    // A public key is 33 bytes starting 02 or 03 (an extended private key would start 00).
    const keyPrefix = payload[45];
    if (version !== expected.public || (keyPrefix !== 0x02 && keyPrefix !== 0x03)) return null;
    return expected.script;
  } catch {
    return null;
  }
}
