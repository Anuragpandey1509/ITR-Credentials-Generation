import { isValidPan, maskPan } from '@itr/shared';

describe('Payload validation', () => {
  describe('isValidPan', () => {
    it('accepts valid PAN formats', () => {
      expect(isValidPan('ABCDE1234F')).toBe(true);
      expect(isValidPan('abcde1234f')).toBe(true); // case-insensitive
      expect(isValidPan('ZZZZZ9999Z')).toBe(true);
    });

    it('rejects invalid PAN formats', () => {
      expect(isValidPan('')).toBe(false);
      expect(isValidPan('ABCD1234F')).toBe(false);   // too short
      expect(isValidPan('12345ABCDE')).toBe(false);  // wrong order
      expect(isValidPan('ABCDE12345')).toBe(false);  // last char not alpha
      expect(isValidPan('ABCDE1234FF')).toBe(false); // too long
      expect(isValidPan('ABCDE123!F')).toBe(false);  // special char
    });
  });

  describe('maskPan', () => {
    it('masks middle of PAN', () => {
      expect(maskPan('ABCDE1234F')).toBe('ABCDE****F');
    });

    it('handles short input safely', () => {
      expect(maskPan('AB')).toBe('**********');
      expect(maskPan('')).toBe('**********');
    });

    it('never reveals full PAN', () => {
      const masked = maskPan('PANPA1234N');
      expect(masked).not.toContain('1234');
    });
  });
});
