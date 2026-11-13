import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bech32 } from '@scure/base';
import { HDKey } from '@scure/bip32';

import { base58check, XPUB_VERSIONS, type XpubScript } from './address';

/**
 * The addresses of an account extended public key (BIP-32), for reading its balance from an
 * explorer that only knows addresses. Derivation uses the public key alone: nothing here could
 * spend anything. `xpub` gives P2PKH (BIP-44), `ypub` P2SH-wrapped segwit (BIP-49) and `zpub`
 * native segwit (BIP-84) addresses, on the receive (0) and change (1) chains.
 */
export type XpubChain = 0 | 1;

export interface XpubDeriver {
  address(chain: XpubChain, index: number): string;
}

export function xpubDeriver(xpub: string, script: XpubScript): XpubDeriver {
  const prefix = xpub.slice(0, 4) as keyof typeof XPUB_VERSIONS;
  // The private version is never used (there is no private key); any value other than the public one will do.
  const account = HDKey.fromExtendedKey(xpub, { private: 0, public: XPUB_VERSIONS[prefix].public });
  const chains = new Map<XpubChain, HDKey>();
  const chainKey = (chain: XpubChain) => {
    let key = chains.get(chain);
    if (!key) {
      key = account.deriveChild(chain);
      chains.set(chain, key);
    }
    return key;
  };
  return {
    address(chain, index) {
      const publicKey = chainKey(chain).deriveChild(index).publicKey;
      if (!publicKey) throw new Error('Extended public key has no public key');
      return addressFor(script, publicKey);
    },
  };
}

const hash160 = (bytes: Uint8Array) => ripemd160(sha256(bytes));

function addressFor(script: XpubScript, publicKey: Uint8Array): string {
  const keyHash = hash160(publicKey);
  if (script === 'p2wpkh') return bech32.encode('bc', [0, ...bech32.toWords(keyHash)]);
  if (script === 'p2pkh') return base58check.encode(Uint8Array.from([0x00, ...keyHash]));
  // P2SH-P2WPKH: the redeem script is OP_0 <20-byte key hash>.
  return base58check.encode(Uint8Array.from([0x05, ...hash160(Uint8Array.from([0x00, 0x14, ...keyHash]))]));
}
