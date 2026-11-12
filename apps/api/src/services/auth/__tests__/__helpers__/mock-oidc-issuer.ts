import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';

/*
 * An OpenID Connect provider in the test process: discovery, a JWKS, and a token endpoint that
 * checks the client secret, the redirect URI and the PKCE verifier before it signs an id_token.
 * It listens on 127.0.0.1 only, and `loopbackFetch` refuses every other host, so a test that
 * uses it cannot reach the network.
 *
 * The browser half of the flow (the provider's login page) is `approve`: a test hands it the
 * authorization URL better-auth built and the claims the person should have, and gets back the
 * code the provider would have redirected to the callback with.
 */

export type Claims = Record<string, unknown>;

export interface MockOidcIssuer {
  /** The code the provider would send to the callback after this person signed in. */
  approve(authorizationUrl: string, claims: Claims): string;
  readonly clientId: string;
  readonly clientSecret: string;
  close(): Promise<void>;
  readonly issuer: string;
  /** Sign the next id_tokens with a key that is not in the JWKS. */
  signWithRogueKey(rogue: boolean): void;
}

interface Grant {
  claims: Claims;
  clientId: string;
  codeChallenge: null | string;
  nonce: null | string;
  redirectUri: string;
  used: boolean;
}

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const base64url = (buffer: Buffer): string => buffer.toString('base64url');

export async function startMockOidcIssuer({ clientId = 'wondermoney', clientSecret = 'issuer-test-secret' } = {}): Promise<MockOidcIssuer> {
  const keys = await generateKeyPair('RS256');
  const rogueKeys = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), alg: 'RS256', kid: 'issuer-key', use: 'sig' };
  const grants = new Map<string, Grant>();
  let rogue = false;
  let issuer = '';

  const token = async (req: IncomingMessage, res: ServerResponse) => {
    const form = new URLSearchParams(await readBody(req));
    const basic = req.headers.authorization?.startsWith('Basic ')
      ? Buffer.from(req.headers.authorization.slice(6), 'base64').toString('utf8').split(':').map(decodeURIComponent)
      : null;
    const [id, secret] = basic ?? [form.get('client_id'), form.get('client_secret')];
    if (id !== clientId || secret !== clientSecret) { json(res, 401, { error: 'invalid_client' }); return; }
    const grant = grants.get(form.get('code') ?? '');
    if (form.get('grant_type') !== 'authorization_code' || !grant || grant.used) { json(res, 400, { error: 'invalid_grant' }); return; }
    grant.used = true;
    if (grant.redirectUri !== form.get('redirect_uri')) { json(res, 400, { error: 'invalid_grant' }); return; }
    const verifier = form.get('code_verifier');
    if (grant.codeChallenge && (!verifier || base64url(createHash('sha256').update(verifier).digest()) !== grant.codeChallenge)) {
      json(res, 400, { error: 'invalid_grant' }); return;
    }
    const idToken = await new SignJWT({ ...(grant.nonce ? { nonce: grant.nonce } : {}), ...grant.claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'issuer-key' })
      .setIssuer(issuer)
      .setAudience(grant.clientId)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(rogue ? rogueKeys.privateKey : keys.privateKey);
    json(res, 200, { access_token: base64url(randomBytes(16)), expires_in: 300, id_token: idToken, token_type: 'Bearer' });
  };

  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', issuer).pathname;
    if (req.method === 'GET' && path === '/.well-known/openid-configuration') {
      json(res, 200, {
        authorization_endpoint: `${issuer}/authorize`,
        id_token_signing_alg_values_supported: ['RS256'],
        issuer,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        token_endpoint: `${issuer}/token`,
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        userinfo_endpoint: `${issuer}/userinfo`,
      }); return;
    }
    if (req.method === 'GET' && path === '/jwks') { json(res, 200, { keys: [jwk] }); return; }
    if (req.method === 'POST' && path === '/token') {
      void token(req, res).catch(() => { json(res, 500, { error: 'server_error' }); });
      return undefined;
    }
    json(res, 404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    approve(authorizationUrl, claims) {
      const url = new URL(authorizationUrl);
      if (`${url.origin}${url.pathname}` !== `${issuer}/authorize`) throw new Error(`Not this issuer's authorization URL: ${authorizationUrl}`);
      const code = base64url(randomBytes(16));
      grants.set(code, {
        claims,
        clientId: url.searchParams.get('client_id') ?? '',
        codeChallenge: url.searchParams.get('code_challenge'),
        nonce: url.searchParams.get('nonce'),
        redirectUri: url.searchParams.get('redirect_uri') ?? '',
        used: false,
      });
      return code;
    },
    clientId,
    clientSecret,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => {
      if (error) reject(error);
      else resolve();
    })),
    get issuer() {
      return issuer;
    },
    signWithRogueKey(value) {
      rogue = value;
    },
  };
}

/**
 * A `fetch` that only talks to 127.0.0.1, over node:http. The test setup replaces the global
 * `fetch` with one that refuses everything; a test that runs the mock issuer stubs this in.
 */
export const loopbackFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname !== '127.0.0.1') throw new Error(`loopbackFetch refuses ${url.origin}: tests stay on 127.0.0.1`);
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  return new Promise<Response>((resolve, reject) => {
    const outgoing = httpRequest(url, { headers: Object.fromEntries(request.headers), method: request.method }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (typeof value === 'string') headers.set(name, value);
        }
        const status = incoming.statusCode ?? 500;
        resolve(new Response(status === 204 ? null : Buffer.concat(chunks), { headers, status }));
      });
      incoming.on('error', reject);
    });
    outgoing.on('error', reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
};
