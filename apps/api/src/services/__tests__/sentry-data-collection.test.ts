import { buildSentryOptions } from '@service/sentry-options';

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import * as Sentry from '@sentry/node';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Real SDK, real HTTP request, no network: events land in an in-memory transport. This is the
// payload Sentry would receive for an error raised while the API handles a request.

type SentEvent = Sentry.ErrorEvent;

const sent: SentEvent[] = [];

function memoryTransport(): ReturnType<NonNullable<Sentry.NodeOptions['transport']>> {
  return {
    flush: async () => true,
    send: async (envelope) => {
      for (const [header, payload] of envelope[1]) {
        if (header.type === 'event') sent.push(payload as SentEvent);
      }
      return {};
    },
  };
}

const SECRET_BODY = JSON.stringify({ balance: 123456.78, email: 'owner@example.com', iban: 'PT50000201231234567890154' });

let server: http.Server;
let requestCount = 0;
let port: number;

async function requestThatErrors(): Promise<SentEvent> {
  sent.length = 0;
  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        headers: {
          authorization: 'Bearer secret-token',
          'content-type': 'application/json',
          cookie: 'better-auth.session_token=abc; theme=dark',
          'user-agent': 'wondermoney-test',
          'x-custom-account': 'PT50000201231234567890154',
          'x-forwarded-for': '203.0.113.7',
        },
        host: '127.0.0.1',
        method: 'POST',
        path: '/v1/accounts?page=2&email=owner%40example.com&code=oauth-code&state=oauth-state',
        port,
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', reject);
    req.end(SECRET_BODY);
  });
  await Sentry.flush(2_000);
  const [event] = sent;
  if (!event) throw new Error('no event reached the transport');
  return event;
}

describe('what a Sentry error event from the API carries', () => {
  beforeAll(async () => {
    Sentry.init({
      ...buildSentryOptions(),
      dsn: 'https://public@o0.ingest.sentry.io/0',
      enabled: true,
      // Default integrations (http instrumentation, request data) but none of the app's
      // database/logging ones, which need real clients.
      integrations: (defaults) => defaults,
      tracesSampler: undefined,
      tracesSampleRate: 0,
      transport: memoryTransport,
    });

    // Express with a JSON body parser, as in `app.ts`, so the request body is parsed and in reach
    // of the SDK when the error is captured.
    const app = express();
    app.use(express.json());
    app.post('/v1/accounts', (req, res) => {
      Sentry.setUser({ id: '42' });
      // A distinct message per request, or the dedupe integration drops repeats.
      requestCount += 1;
      Sentry.captureException(new Error(`handler failed on request ${requestCount} (${Object.keys(req.body).length} fields)`));
      res.sendStatus(500);
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => { resolve(); }));
    await Sentry.close(2_000);
  });

  it('keeps the user id but no email or IP address', async () => {
    const event = await requestThatErrors();

    expect(event.user?.id).toBe('42');
    expect(event.user?.email).toBeUndefined();
    expect(event.user?.ip_address).toBeUndefined();
  });

  it('sends no request body, cookies, auth header or forwarding headers', async () => {
    const event = await requestThatErrors();
    const serialized = JSON.stringify(event);

    expect(serialized).not.toContain('owner@example.com');
    expect(serialized).not.toContain('123456.78');
    expect(serialized).not.toContain('PT50000201231234567890154');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('better-auth.session_token=abc');
    expect(serialized).not.toContain('203.0.113.7');
    expect(serialized).not.toContain('oauth-code');
    expect(serialized).not.toContain('oauth-state');
    expect(event.request?.cookies ?? {}).toEqual({});
  });

  it('keeps the request method and path so the error stays debuggable', async () => {
    const event = await requestThatErrors();

    expect(event.request?.method).toBe('POST');
    expect(event.request?.url).toBe('/v1/accounts');
  });

  // `beforeSend` redacts again, so the tests above would pass even if `dataCollection` were
  // wide open. Here the SDK's own filter is the only thing between the request and Sentry.
  it('filters disallowed headers and query parameters even without the beforeSend scrub', async () => {
    const client = Sentry.getClient();
    if (!client) throw new Error('Sentry is not initialised');
    const options = client.getOptions();
    const beforeSend = options.beforeSend;
    options.beforeSend = undefined;
    try {
      const event = await requestThatErrors();
      const headers = event.request?.headers ?? {};

      expect(headers['user-agent']).toBe('wondermoney-test');
      expect(headers['content-type']).toBe('application/json');
      expect(JSON.stringify(event)).not.toContain('PT50000201231234567890154');
      expect(JSON.stringify(event)).not.toContain('secret-token');
      expect(JSON.stringify(event)).not.toContain('203.0.113.7');
      expect(JSON.stringify(event)).not.toContain('owner%40example.com');
      expect(event.request?.data).toBeUndefined();
      expect(event.request?.query_string).toContain('page=2');
    } finally {
      options.beforeSend = beforeSend;
    }
  });
});
