import { describe, expect, it } from 'vitest';

import { looksLikeWalletSecret } from '../lib/crypto-wallet';

// Synthetic values in the shapes wallets export, built rather than written out. None is a real key.
const HEX_KEY = 'ab'.repeat(32);
const WIF_UNCOMPRESSED = `5${'H'.repeat(50)}`;
const WIF_COMPRESSED = `K${'w'.repeat(51)}`;
const XPRV = `xprv9s21${'Z'.repeat(103)}`;

describe('looksLikeWalletSecret', () => {
  it.each([
    ['a raw hex key', HEX_KEY],
    ['a raw hex key with 0x', `0x${HEX_KEY}`],
    ['an uncompressed WIF key', WIF_UNCOMPRESSED],
    ['a compressed WIF key', WIF_COMPRESSED],
    ['an extended private key', XPRV],
    ['a zprv', `z${XPRV.slice(1)}`],
  ])('calls %s a private key', (_label, input) => {
    expect(looksLikeWalletSecret(`  ${input}\n`)).toBe('private_key');
  });

  it.each([12, 15, 18, 21, 24])('calls a phrase of %i words a seed phrase', (count) => {
    const phrase = Array.from({ length: count }, (_, index) => ['abandon', 'zoo', 'legal', 'winner'][index % 4]).join(' ');
    expect(looksLikeWalletSecret(phrase)).toBe('seed_phrase');
    expect(looksLikeWalletSecret(phrase.toUpperCase().split(' ').join('\n'))).toBe('seed_phrase');
  });

  it.each([
    ['a legacy Bitcoin address', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'],
    ['a bech32 address', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
    ['a taproot address', 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'],
    ['an xpub', 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'],
    ['an Ethereum address', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'],
    ['an eleven-word note', 'my cold wallet on the shelf in the blue box near'],
    ['nothing', '   '],
  ])('lets %s through', (_label, input) => {
    expect(looksLikeWalletSecret(input)).toBeNull();
  });
});
