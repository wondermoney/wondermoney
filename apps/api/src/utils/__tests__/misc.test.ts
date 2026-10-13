import { describe, expect, it } from 'vitest';

import { getFullName, maskEmail } from '@utils/misc';

describe('misc utils', () => {
  describe('getFullName', () => {
    it('joins first and last name with a space', () => {
      expect(getFullName('Jane', 'Doe')).toBe('Jane Doe');
    });

    it('handles missing parts gracefully', () => {
      expect(getFullName('Jane')).toBe('Jane');
      expect(getFullName(undefined, 'Doe')).toBe('Doe');
      expect(getFullName()).toBe('');
    });
  });

  describe('maskEmail', () => {
    it('masks the local part, keeping the first character', () => {
      expect(maskEmail('john.doe@example.com')).toBe('j*******@example.com');
    });

    it('returns *** when domain is missing', () => {
      expect(maskEmail('no-at-symbol')).toBe('***');
    });

    it('returns null when email is nullish', () => {
      expect(maskEmail(null)).toBeNull();
      expect(maskEmail(undefined)).toBeNull();
    });
  });
});

