// updater.js — Native auto-update module for Electron desktop apps
// Checks backend for new version, downloads installer, launches it.

const https = require('https');
const http = require('http');
const fs = require('fs');

/**
 * Check backend for available update.
 * @param {string} backendUrl - Backend API base URL
 * @param {string} currentVersion - Current app version (semver)
 * @param {string} appName - App identifier for backend ('operator-panel' or 'validator')
 * @returns {Promise<{updateAvailable: boolean, latestVersion: string, downloadUrl: string, changelog: string} | null>}
 */
function checkForUpdate(backendUrl, currentVersion, appName) {
  return new Promise((resolve) => {
    if (!backendUrl || !currentVersion) {
      resolve(null);
      return;
    }

    const base = backendUrl.replace(/\/+$/, '');
    const url = `${base}/api/settings/check-update?app=${encodeURIComponent(appName)}&currentVersion=${encodeURIComponent(currentVersion)}`;

    const client = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => resolve(null), 10000);

    try {
      const req = client.get(url, (res) => {
        clearTimeout(timeout);
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.updateAvailable) {
              resolve(null);
              return;
            }
            resolve({
              updateAvailable: true,
              latestVersion: json.latestVersion,
              downloadUrl: json.apkUrl || '', // backend uses "apkUrl" key for all platforms
              changelog: json.changelog || '',
            });
          } catch {
            resolve(null);
          }
        });
      });

      req.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });

      req.end();
    } catch {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}

/**
 * Download file from URL to destPath with progress callback.
 * Follows up to 5 HTTP redirects.
 * @param {string} url - Download URL
 * @param {string} destPath - Local file path to write to
 * @param {(percent: number) => void} onProgress - Progress callback (0-100)
 * @param {number} redirectCount - Internal redirect counter
 * @returns {Promise<string>} Final file path
 */
function downloadUpdate(url, destPath, onProgress, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Demasiados redirects'));
      return;
    }

    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, (res) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        downloadUpdate(res.headers.location, destPath, onProgress, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Error de descarga: HTTP ${res.statusCode}`));
        return;
      }

      const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
      let receivedBytes = 0;
      const file = fs.createWriteStream(destPath);

      res.on('data', (chunk) => {
        receivedBytes += chunk.length;
        file.write(chunk);
        if (totalBytes > 0) {
          onProgress(Math.round((receivedBytes / totalBytes) * 100));
        }
      });

      res.on('end', () => {
        file.end(() => resolve(destPath));
      });

      res.on('error', (err) => {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

module.exports = { checkForUpdate, downloadUpdate };
