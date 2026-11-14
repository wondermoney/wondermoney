import { describe, expect, it } from 'vitest';

import { acceptLanguageLocale } from '@service/auth/sign-up-locale';

describe('acceptLanguageLocale', () => {
  it.each([
    ['pt-PT', 'pt'],
    ['pt', 'pt'],
    ['es', 'es'],
    ['es-419', 'es'],
    ['en', 'en'],
    ['EN-GB', 'en'],
    ['pt_PT', 'pt'],
    ['es;q=0.9, en;q=0.8', 'es'],
    ['pt-PT,pt;q=0.9,en;q=0.8', 'pt'],
  ])('reads %s as %s', (header, locale) => {
    expect(acceptLanguageLocale(header)).toBe(locale);
  });

  it.each([[undefined], [null], [''], ['fr-FR'], ['*'], ['fr, es;q=0.9'], ['ptx']])(
    'names no locale for %s',
    (header) => {
      expect(acceptLanguageLocale(header)).toBeUndefined();
    },
  );
});
