/**
 * Conservative Argentine phone normalizer — the single source of truth for
 * canonicalizing phone numbers across auth (login gate) and user preload/import.
 *
 * IMPORTANT: this is the login gate for thousands of preloaded users. Both the
 * stored phone (set at CSV import) and the typed phone (at login) MUST pass
 * through this same function so equal numbers canonicalize identically. Keeping
 * two divergent copies previously risked silently breaking every login — do not
 * fork this again; import from here.
 *
 * Target canonical form for AR mobiles: "549<area><subscriber>" where
 * <area><subscriber> is the 10-digit National Significant Number (NSN).
 *
 * Handles the common ways Argentines write their own number:
 *   - International:      +54 9 3624 149207   / 5493624149207
 *   - Country, no "9":    54 3624 149207
 *   - Trunk prefix "0":   0 3624 149207
 *   - Cell prefix "15":   3624 15 149207  /  0 3624 15 149207
 *   - Plain NSN:          3624 149207
 *
 * Foreign-looking / unrecognized numbers are returned as digits-only unchanged
 * (so they still compare deterministically, just without AR reshaping).
 */
export function canonicalArPhone(raw: string): string {
  let digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';

  // International exit code
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Strip country code (with or without the "9" mobile marker). International
  // format never carries the local "15" cell prefix, so what remains is the NSN.
  let hadCountry = false;
  if (digits.startsWith('549')) {
    digits = digits.slice(3);
    hadCountry = true;
  } else if (
    digits.startsWith('54') &&
    digits.length >= 11 &&
    digits.length <= 13
  ) {
    digits = digits.slice(2);
    hadCountry = true;
  } else if (
    digits.startsWith('9') &&
    digits.length >= 11 &&
    digits.length <= 12
  ) {
    // "9<area><subscriber>" — mobile marker without country code
    digits = digits.slice(1);
    hadCountry = true;
  }

  // Local dialing: strip the trunk "0" prefix (only when we didn't already
  // consume a country code, to avoid eating a subscriber digit).
  if (!hadCountry && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Remove the "15" cell prefix that local dialing inserts right after the area
  // code. A legit AR NSN is 10 digits; with "15" it becomes 12. Try the known
  // area-code lengths (2 = CABA/GBA "11", 3 and 4 = interior) and drop the "15"
  // that yields a valid 10-digit NSN.
  if (digits.length === 12) {
    for (const areaLen of [2, 3, 4]) {
      if (digits.slice(areaLen, areaLen + 2) === '15') {
        const candidate = digits.slice(0, areaLen) + digits.slice(areaLen + 2);
        if (candidate.length === 10) {
          digits = candidate;
          break;
        }
      }
    }
  }

  // Valid AR NSN → canonical mobile form.
  if (digits.length === 10) {
    return '549' + digits;
  }

  // Unrecognized / foreign: return whatever digits we have, unchanged.
  return digits;
}
