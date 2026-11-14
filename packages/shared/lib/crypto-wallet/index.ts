/**
 * Telling a wallet secret from a public address, before it goes anywhere.
 *
 * A crypto wallet is tracked from its public addresses only. People paste the wrong thing: a
 * private key exported from a wallet app, or the recovery phrase written on paper. Whoever holds
 * either can spend the coins, so the clients refuse it before sending it, and the API refuses it
 * again without logging, storing or echoing it.
 *
 * This is a shape check, deliberately wide: a near miss (a key with a typo) is still a secret.
 * It needs no wordlist; the API also checks a phrase against the BIP-39 wordlist.
 */
export type WalletSecretKind = 'private_key' | 'seed_phrase';

const BASE58 = '[1-9A-HJ-NP-Za-km-z]';

/** Word counts a BIP-39 recovery phrase can have. */
export const SEED_PHRASE_WORD_COUNTS: readonly number[] = [12, 15, 18, 21, 24];

const PRIVATE_KEY_SHAPES: readonly RegExp[] = [
  // A raw secp256k1 key: 32 bytes of hex, with or without 0x (Ethereum wallets export this).
  /^(?:0x)?[0-9a-f]{64}$/iu,
  // Wallet import format: uncompressed (5…, 51 characters) and compressed (K…/L…, 52) on
  // mainnet; 9… and c… on testnet.
  new RegExp(`^[59]${BASE58}{50}$`, 'u'),
  new RegExp(`^[KLc]${BASE58}{51}$`, 'u'),
  // BIP-38 encrypted key: still the key, behind a passphrase.
  new RegExp(`^6P${BASE58}{56}$`, 'u'),
  // Extended private keys (BIP-32/49/84 and their testnet forms): xprv, yprv, zprv, tprv, uprv,
  // vprv, Yprv, Zprv, Uprv, Vprv. The prefix alone gives one away.
  /^[xyztuvYZUV]prv/u,
];

/** The words of a pasted phrase: letters only, any whitespace or line breaks between them. */
export function phraseWords(input: string): string[] {
  return input.trim().toLowerCase().split(/[\s,]+/u).filter((word) => word.length > 0);
}

/**
 * `private_key` or `seed_phrase` when `input` looks like a wallet secret, else null. Null does
 * not mean the input is a valid address: only that it does not look like a secret.
 */
export function looksLikeWalletSecret(input: string): null | WalletSecretKind {
  const value = input.trim();
  if (value.length === 0) return null;
  if (PRIVATE_KEY_SHAPES.some((shape) => shape.test(value))) return 'private_key';
  const words = phraseWords(value);
  if (SEED_PHRASE_WORD_COUNTS.includes(words.length) && words.every((word) => /^[a-z]+$/u.test(word))) return 'seed_phrase';
  return null;
}
