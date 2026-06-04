/**
 * OCR Parser — Auto-detects platform and extracts fields.
 *
 * Uses the pattern registry (patterns/index.js) to detect which
 * bank/wallet the receipt is from and extract structured data.
 *
 * Each platform has its own pattern file in patterns/ with:
 * - detect(text) — identifies the platform from OCR text
 * - extract(text) — pulls out amount, date, sender, etc.
 */

const { detectAndExtract, getRegisteredPlatforms } = require('./patterns');
const { parseAmount } = require('./patterns/_helpers');

/**
 * Parse structured payment data from raw OCR text.
 * Auto-detects the platform and uses platform-specific patterns.
 *
 * @param {string} text — Raw OCR text from Tesseract
 * @param {number} expectedAmount — Expected amount (0 = auto-detect)
 * @returns {object} Extracted fields with confidence score
 */
function parseOCRText(text, expectedAmount = 0) {
  const exp = expectedAmount > 0 ? expectedAmount : null;
  const { platform, platformName, fields } = detectAndExtract(text, exp);

  // Add platform info to fields
  fields.detectedPlatform = platform;
  fields.detectedPlatformName = platformName;

  return fields;
}

// Re-export for backward compatibility
function parseArgentineAmount(str) {
  return parseAmount(str);
}

module.exports = { parseOCRText, parseArgentineAmount, getRegisteredPlatforms };
