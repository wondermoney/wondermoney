import { describe, expect, it } from 'vitest';

import { fromMimetypeToExtension } from '@utils/mimetype';

describe('mimetype utils', () => {
  it('returns the correct extension for supported mimetypes', () => {
    expect(fromMimetypeToExtension('image/jpeg')).toBe('jpg');
    expect(fromMimetypeToExtension('image/png')).toBe('png');
    expect(fromMimetypeToExtension('application/pdf')).toBe('pdf');
  });

  it('throws for unsupported mimetypes', () => {
    expect(() => fromMimetypeToExtension('text/plain')).toThrow('Unsupported mimetype');
  });
});

