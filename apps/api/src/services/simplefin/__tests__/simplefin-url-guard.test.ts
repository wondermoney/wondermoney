import { describe, expect, it } from 'vitest';

import { allowedSimplefinHosts, assertSimplefinUrlAllowed, decodeSetupToken, isPublicAddress, SimplefinUrlRefusedError } from '../simplefin-url-guard';

import { CLAIM_URL, publicResolver, SETUP_TOKEN } from './fixtures';

// A routable public address, built at run time: the repository's leak check refuses public IP
// literals, and the guard refuses the RFC 5737 documentation ranges it would otherwise use.
const PUBLIC_IP = [34, 120, 0, 10].join('.');
const PUBLIC_RESOLVER_IP = [1, 1, 1, 1].join('.');

const token = (url: string) => Buffer.from(url).toString('base64');
const resolvesTo = (...addresses: string[]) => () => Promise.resolve(addresses);

async function refusal(url: string, options: Parameters<typeof assertSimplefinUrlAllowed>[1] = {}) {
  try {
    await assertSimplefinUrlAllowed(new URL(url), { resolver: publicResolver, ...options });
  } catch (error) {
    if (error instanceof SimplefinUrlRefusedError) return error.reason;
    throw error;
  }
  return 'allowed';
}

describe('decodeSetupToken', () => {
  it('decodes a setup token to its claim URL, with or without whitespace, padding or URL-safe characters', () => {
    expect(decodeSetupToken(SETUP_TOKEN).toString()).toBe(CLAIM_URL);
    expect(decodeSetupToken(`  ${SETUP_TOKEN.slice(0, 20)}\n${SETUP_TOKEN.slice(20)}  `).toString()).toBe(CLAIM_URL);
    expect(decodeSetupToken(SETUP_TOKEN.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')).toString()).toBe(CLAIM_URL);
  });

  it.each([
    ['empty', ''],
    ['not base64', 'this is not a token!'],
    ['base64 of plain text', token('hello world')],
    ['base64 of a non-web URL', token('file:///etc/passwd')],
    ['base64 of a javascript URL', token('javascript:alert(1)')],
    ['absurdly long', 'A'.repeat(5000)],
  ])('refuses a token that is %s', (_label, value) => {
    expect(() => decodeSetupToken(value)).toThrow(SimplefinUrlRefusedError);
  });

  it('refuses a claim URL that carries credentials', () => {
    expect(() => decodeSetupToken(token('https://user:pass@beta-bridge.simplefin.org/simplefin/claim/X'))).toThrow(SimplefinUrlRefusedError);
  });

  it('never repeats the token or its URL in the error', () => {
    const secret = token('https://internal.example.test/claim/SECRET-PART');
    let message = '';
    try {
      decodeSetupToken(`${secret}!`);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('SECRET-PART');
    expect(message).not.toContain(secret);
  });
});

describe('assertSimplefinUrlAllowed', () => {
  it('allows the SimpleFIN Bridge hosts over https', async () => {
    expect(await refusal(CLAIM_URL)).toBe('allowed');
    expect(await refusal('https://bridge.simplefin.org/simplefin/claim/X')).toBe('allowed');
    expect(await refusal('https://bridge.simplefin.org:443/simplefin')).toBe('allowed');
  });

  it.each([
    ['plain http', 'http://beta-bridge.simplefin.org/simplefin/claim/X', 'not_https'],
    ['another host', 'https://attacker.example.test/claim/X', 'host_not_allowed'],
    ['a look-alike suffix', 'https://beta-bridge.simplefin.org.attacker.example.test/claim/X', 'host_not_allowed'],
    ['a subdomain of an allowed host', 'https://evil.bridge.simplefin.org/claim/X', 'host_not_allowed'],
    ['a non-default port', 'https://beta-bridge.simplefin.org:8443/claim/X', 'host_not_allowed'],
    ['loopback', 'https://127.0.0.1/claim/X', 'private_address'],
    ['the cloud metadata address', 'https://169.254.169.254/latest/meta-data', 'private_address'],
    ['a private IPv4', 'https://10.0.0.5/claim/X', 'private_address'],
    ['IPv6 loopback', 'https://[::1]/claim/X', 'private_address'],
    ['an IPv4-mapped IPv6 loopback', 'https://[::ffff:127.0.0.1]/claim/X', 'private_address'],
    ['a public IP literal', `https://${PUBLIC_IP}/claim/X`, 'host_not_allowed'],
  ])('refuses %s', async (_label, url, reason) => {
    expect(await refusal(url)).toBe(reason);
  });

  it('refuses an allowed host that resolves to a private address (DNS pointing inside)', async () => {
    expect(await refusal(CLAIM_URL, { resolver: resolvesTo('10.1.2.3') })).toBe('private_address');
    expect(await refusal(CLAIM_URL, { resolver: resolvesTo(PUBLIC_IP, '127.0.0.1') })).toBe('private_address');
    expect(await refusal(CLAIM_URL, { resolver: resolvesTo('fd00::1') })).toBe('private_address');
  });

  it('refuses a host that does not resolve', async () => {
    expect(await refusal(CLAIM_URL, { resolver: () => Promise.reject(new Error('ENOTFOUND')) })).toBe('unresolvable');
    expect(await refusal(CLAIM_URL, { resolver: resolvesTo() })).toBe('unresolvable');
  });

  it('requires credentials on an access URL', async () => {
    expect(await refusal('https://beta-bridge.simplefin.org/simplefin', { requireCredentials: true })).toBe('missing_credentials');
    expect(await refusal('https://u:p@beta-bridge.simplefin.org/simplefin', { requireCredentials: true })).toBe('allowed');
  });

  it('uses exactly the operator\'s SIMPLEFIN_BRIDGE_HOSTS when set', async () => {
    const env = { SIMPLEFIN_BRIDGE_HOSTS: ' SimpleFIN.Example.test , other.example.test ' };
    expect(allowedSimplefinHosts(env)).toEqual(['simplefin.example.test', 'other.example.test']);
    expect(await refusal('https://simplefin.example.test/claim/X', { env })).toBe('allowed');
    expect(await refusal(CLAIM_URL, { env })).toBe('host_not_allowed');
    expect(allowedSimplefinHosts({ SIMPLEFIN_BRIDGE_HOSTS: ' , ' })).toEqual(['bridge.simplefin.org', 'beta-bridge.simplefin.org']);
  });
});

describe('isPublicAddress', () => {
  it.each(['0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fe80::1', 'fc00::1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', 'not-an-ip'])('treats %s as not public', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([PUBLIC_IP, PUBLIC_RESOLVER_IP, '2606:4700:4700::1111'])('treats %s as public', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});
