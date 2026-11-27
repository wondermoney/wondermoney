import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { errorHandler } from '@middleware/error-handler';
import openAiAppsChallengeRoutes from '@route/openai-apps-challenge';

const TOKEN = 'oa-challenge-4f1c2b7e9d';

function app() {
  const host = express();
  host.use('/.well-known', openAiAppsChallengeRoutes);
  host.use(errorHandler);
  return request(host);
}

describe('GET /.well-known/openai-apps-challenge', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('answers the configured token alone, as plain text', async () => {
    vi.stubEnv('OPENAI_APPS_CHALLENGE', TOKEN);

    const response = await app().get('/.well-known/openai-apps-challenge').expect(200);

    expect(response.headers['content-type']).toMatch(/^text\/plain\b/);
    expect(response.text).toBe(TOKEN);
  });

  it('leaves out whitespace pasted around the token', async () => {
    vi.stubEnv('OPENAI_APPS_CHALLENGE', `  ${TOKEN}\n`);

    expect((await app().get('/.well-known/openai-apps-challenge').expect(200)).text).toBe(TOKEN);
  });

  it('answers 404 while the setting is unset or blank', async () => {
    vi.stubEnv('OPENAI_APPS_CHALLENGE', undefined);
    expect((await app().get('/.well-known/openai-apps-challenge')).status).toBe(404);

    vi.stubEnv('OPENAI_APPS_CHALLENGE', '   ');
    expect((await app().get('/.well-known/openai-apps-challenge')).status).toBe(404);
  });

  it('is not cached, so a replaced token is served at once', async () => {
    vi.stubEnv('OPENAI_APPS_CHALLENGE', TOKEN);
    await app().get('/.well-known/openai-apps-challenge').expect(200);

    vi.stubEnv('OPENAI_APPS_CHALLENGE', 'oa-challenge-replaced');
    const response = await app().get('/.well-known/openai-apps-challenge').expect(200);

    expect(response.text).toBe('oa-challenge-replaced');
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
