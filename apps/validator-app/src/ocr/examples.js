const fs = require('fs');
const path = require('path');
const logger = require('../logger');

function getOcrExamplesPath(getPath) {
  return path.join(getPath(), 'ocr-examples.json');
}

function loadOcrExamples(getPath) {
  try {
    if (fs.existsSync(getOcrExamplesPath(getPath))) {
      return JSON.parse(fs.readFileSync(getOcrExamplesPath(getPath), 'utf-8'));
    }
  } catch (err) {
    logger.warn('OCR', `Failed to load examples: ${err.message}`);
  }
  return { examples: [], stats: { totalExamples: 0, bySource: {} } };
}

function saveOcrExamples(getPath, data) {
  const tmpPath = getOcrExamplesPath(getPath) + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, getOcrExamplesPath(getPath));
}

module.exports = { getOcrExamplesPath, loadOcrExamples, saveOcrExamples };
