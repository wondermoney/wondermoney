import { describe, expect, it } from 'vitest';

import { classifyWalletInput, isWalletSecret } from '../address';

import { BIP39_TEST_PHRASE, BTC, ETH, SECRETS } from './__fixtures__/wallet-fixtures';

describe('classifyWalletInput', () => {
  it.each([
    ['legacy P2PKH', BTC.legacy],
    ['P2SH', BTC.p2sh],
    ['bech32 segwit', BTC.segwit],
    ['bech32m taproot', BTC.taproot],
  ])('accepts a %s Bitcoin address', (_label, address) => {
    expect(classifyWalletInput('bitcoin', `  ${address} `)).toEqual({ address, kind: 'address', ok: true });
  });

  it('accepts an upper-case bech32 address and stores it lower-case', () => {
    expect(classifyWalletInput('bitcoin', BTC.segwit.toUpperCase())).toEqual({ address: BTC.segwit, kind: 'address', ok: true });
  });

  it.each([
    ['xpub', BTC.xpub, 'p2pkh'],
    ['ypub', BTC.ypub, 'p2sh-p2wpkh'],
    ['zpub', BTC.zpub, 'p2wpkh'],
  ])('accepts an %s as an extended public key', (_label, xpub, script) => {
    expect(classifyWalletInput('bitcoin', xpub)).toEqual({ address: xpub, kind: 'xpub', ok: true, script });
  });

  it.each([
    ['a base58 address with a broken checksum', `${BTC.legacy.slice(0, -1)}3`],
    ['a bech32 address with a broken checksum', `${BTC.segwit.slice(0, -1)}a`],
    ['mixed-case bech32', `bc1Q${BTC.segwit.slice(4)}`],
    ['a taproot address encoded in bech32 instead of bech32m', 'bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7k7grplx'],
    ['a testnet address', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'],
    ['an Ethereum address', ETH.checksummed],
    ['an xpub with a broken checksum', `${BTC.xpub.slice(0, -1)}k`],
    ['free text', 'my savings'],
  ])('refuses %s on Bitcoin', (_label, input) => {
    expect(classifyWalletInput('bitcoin', input)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('accepts a checksummed, an all-lower and an all-upper Ethereum address, stored checksummed', () => {
    for (const input of [ETH.checksummed, ETH.checksummed.toLowerCase(), `0x${ETH.checksummed.slice(2).toUpperCase()}`]) {
      expect(classifyWalletInput('ethereum', input)).toEqual({ address: ETH.checksummed, kind: 'address', ok: true });
    }
  });

  it('refuses an Ethereum address whose mixed case breaks its EIP-55 checksum', () => {
    const upper = ETH.checksummed.search(/[A-F]/u);
    const broken = `${ETH.checksummed.slice(0, upper)}${ETH.checksummed.charAt(upper).toLowerCase()}${ETH.checksummed.slice(upper + 1)}`;
    expect(broken).not.toBe(ETH.checksummed);
    expect(classifyWalletInput('ethereum', broken)).toEqual({ ok: false, reason: 'invalid' });
    expect(classifyWalletInput('ethereum', BTC.segwit)).toEqual({ ok: false, reason: 'invalid' });
  });

  it.each(Object.entries(SECRETS))('refuses %s as a secret on both chains, without returning it', (_label, secret) => {
    for (const chain of ['bitcoin', 'ethereum'] as const) {
      const result = classifyWalletInput(chain, secret);
      expect(result).toEqual({ ok: false, reason: 'secret' });
      expect(JSON.stringify(result)).not.toContain(secret.trim().slice(0, 12));
    }
  });
});

describe('isWalletSecret', () => {
  it('counts a phrase mostly made of BIP-39 words, even with a typo, as a recovery phrase', () => {
    const typo = BIP39_TEST_PHRASE.replace('about', 'abuot');
    expect(isWalletSecret(typo)).toBe(true);
    expect(isWalletSecret(BIP39_TEST_PHRASE.split(' ').join('\n'))).toBe(true);
  });

  it('does not count a sentence of the wrong length', () => {
    expect(isWalletSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')).toBe(false);
  });
});
