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
    ['es', SupportedLanguages.EN],
    ['pt', SupportedLanguages.PT],
  ] as const)('maps route locale %s to supported email language %s', (locale, language) => {
    expect(mapRouteLocaleToEmailLanguage(locale)).toBe(language);
  });
});
