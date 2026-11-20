import { describe, expect, it } from 'vitest';

import { SupportedLanguages } from '@entity/Appuser';
import { authCallbackRequestSchema, mapRouteLocaleToEmailLanguage } from '@validators/auth';

describe('auth callback request boundary', () => {
  it('defaults a missing route locale to English', () => {
    // Given
    const request = { body: {} };

    // When
    const parsed = authCallbackRequestSchema.parse(request);

    // Then
    expect(parsed.body.locale).toBe('en');
    expect(mapRouteLocaleToEmailLanguage(parsed.body.locale)).toBe(SupportedLanguages.EN);
  });

  it.each([
    ['en', SupportedLanguages.EN],
    ['es', SupportedLanguages.ES],
    ['pt', SupportedLanguages.PT],
  ] as const)('maps route locale %s to supported email language %s', (locale, language) => {
    expect(mapRouteLocaleToEmailLanguage(locale)).toBe(language);
  });

  it('keeps a landing page route id', () => {
    const parsed = authCallbackRequestSchema.parse({ body: { landingSource: 'curatedPodcasts' } });

    expect(parsed.body.landingSource).toBe('curatedPodcasts');
  });

  // Analytics must never fail a signup: a malformed source is dropped, not a 400.
  it.each([
    'https://example.com',
    'tool-mortgage',
    'person@example.com',
    'x'.repeat(65),
    42,
  ])('drops a malformed landing source: %s', (landingSource) => {
    const parsed = authCallbackRequestSchema.parse({ body: { landingSource, locale: 'pt' } });

    expect(parsed.body).toEqual({ locale: 'pt' });
  });
});
