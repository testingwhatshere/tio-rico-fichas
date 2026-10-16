import { canonicalArPhone } from './phone.util';

describe('canonicalArPhone', () => {
  // The 15edit15 case: DB stores 5493624149207 (area 3624, subscriber 149207).
  // The user must be able to type it in any common Argentine format and match.
  describe('interior number (area 3624, subscriber 149207)', () => {
    const CANON = '5493624149207';
    const cases = [
      '5493624149207', // already canonical
      '+54 9 3624 149207', // international with punctuation
      '543624149207', // country code, no "9"
      '3624149207', // plain NSN
      '03624149207', // trunk "0"
      '362415149207', // "15" cell prefix, no trunk
      '03624-15-149207', // trunk + "15" + punctuation
      '00543624149207', // intl exit code 00
    ];
    it.each(cases)('canonicalizes "%s" to %s', (input) => {
      expect(canonicalArPhone(input)).toBe(CANON);
    });
  });

  describe('CABA/GBA number (area 11, subscriber 34567890)', () => {
    const CANON = '5491134567890';
    const cases = [
      '5491134567890',
      '+54 9 11 3456-7890',
      '541134567890', // country, no 9
      '1134567890', // plain NSN
      '01134567890', // trunk 0
      '1115345678 90'.replace(/\s/g, ''), // "11 15 34567890" cell prefix -> 111534567890
      '011 15 3456-7890'.replace(/[^0-9]/g, ''), // 01115 34567890 -> 0111534567890
    ];
    it.each(cases)('canonicalizes "%s" to %s', (input) => {
      expect(canonicalArPhone(input)).toBe(CANON);
    });
  });

  describe('idempotency', () => {
    it('re-canonicalizing a stored canonical value is stable', () => {
      // Guards the login gate: stored phones (canonicalized at import) must
      // survive re-canonicalization identically or every preloaded login breaks.
      const stored = '5493624149207';
      expect(canonicalArPhone(canonicalArPhone(stored))).toBe(stored);
    });
  });

  describe('foreign / unrecognized numbers', () => {
    it('leaves a Chilean number without a wrong 549 prefix', () => {
      // 11-digit foreign should not be reshaped into an AR mobile.
      expect(canonicalArPhone('+56 9 1234 5678')).toBe('56912345678');
    });
    it('returns empty string for empty input', () => {
      expect(canonicalArPhone('')).toBe('');
      expect(canonicalArPhone('   ')).toBe('');
    });
  });
});
