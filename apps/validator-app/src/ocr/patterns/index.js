/**
 * OCR Pattern Registry — Auto-detection of payment platform from receipt text.
 *
 * Architecture:
 * - platforms.js: Declarative config for each bank/wallet (keywords + optional overrides)
 * - generic.js: THE single extractor that uses _helpers.js for all fields
 * - _helpers.js: Shared regex-based extraction functions (amount, date, sender, etc.)
 *
 * Detection: iterate platforms by keyword match. First match wins.
 * Extraction: always uses generic.extract() with platform-specific overrides if any.
 * Fallback: if no platform matches, generic.extract() runs without overrides.
 */

const { PLATFORMS } = require('./platforms');
const { extract } = require('./generic');

/**
 * Detect platform from OCR text by checking keywords.
 * @param {string} lowerText — Lowercased OCR text
 * @returns {object|null} Matched platform config, or null for generic fallback
 */
function detectPlatform(lowerText) {
  for (const platform of PLATFORMS) {
    // Check anti-keywords first
    if (platform.antiKeywords) {
      const blocked = platform.antiKeywords.some(kw => lowerText.includes(kw));
      if (blocked) continue;
    }

    const matched = platform.keywords.some(kw => lowerText.includes(kw));
    if (matched) return platform;
  }
  return null;
}

/**
 * Auto-detect platform and extract fields from OCR text.
 * @param {string} text — Raw OCR text from Tesseract
 * @param {number} [expectedAmount] — When provided, used to disambiguate amounts.
 * @returns {{ platform: string, platformName: string, fields: object }}
 */
function detectAndExtract(text, expectedAmount = null) {
  // Collapse whitespace for platform detection so keywords like "onda siempre"
  // match even when the OCR puts a newline between the two words.
  const lower = text.toLowerCase().replace(/\s+/g, ' ');
  const platform = detectPlatform(lower);

  if (platform) {
    const fields = extract(text, platform.overrides || {}, platform.name, expectedAmount);
    return {
      platform: platform.id,
      platformName: platform.name,
      fields,
    };
  }

  // No platform matched — generic extraction (still benefits from expectedAmount disambiguation).
  const fields = extract(text, {}, null, expectedAmount);
  return {
    platform: 'generic',
    platformName: 'Genérico',
    fields,
  };
}

/**
 * Get list of all registered platforms (for UI display).
 */
function getRegisteredPlatforms() {
  return [
    ...PLATFORMS.map(p => ({ id: p.id, name: p.name })),
    { id: 'generic', name: 'Genérico' },
  ];
}

module.exports = { detectAndExtract, getRegisteredPlatforms, PLATFORMS };
