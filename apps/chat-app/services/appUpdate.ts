import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';

// EXPO_PUBLIC_API_URL ya incluye el sufijo /api (ej: https://tiorico-api.onrender.com/api).
// Antes el código pegaba /api/settings/... arriba y resultaba en /api/api/settings/check-update → 404
// silencioso, así que los APK nunca recibían el aviso de actualización.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://tiorico-api.onrender.com/api';
const APP_NAME = 'chat';

export interface UpdateInfo {
  updateAvailable: boolean;
  latestVersion: string;
  apkUrl: string;
  changelog: string;
}

/**
 * Check if a new version is available from the backend.
 * Uses raw fetch (no auth needed — public endpoint).
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const currentVersion = Constants.expoConfig?.version || '1.0.0';
    const url = `${API_BASE_URL}/settings/check-update?app=${APP_NAME}&currentVersion=${currentVersion}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.updateAvailable) return null;

    return data as UpdateInfo;
  } catch {
    // Silent fail — don't block app if backend is unreachable
    return null;
  }
}

/**
 * Download APK to cache directory with progress callback.
 * Returns the local file URI.
 */
export async function downloadApk(
  apkUrl: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  const fileUri = FileSystem.cacheDirectory + 'update.apk';

  // Delete old APK if it exists
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (fileInfo.exists) {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  }

  const downloadResumable = FileSystem.createDownloadResumable(
    apkUrl,
    fileUri,
    {},
    (downloadProgress) => {
      const percent = Math.round(
        (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100,
      );
      onProgress(percent);
    },
  );

  const result = await downloadResumable.downloadAsync();
  if (!result?.uri) {
    throw new Error('Download failed — no URI returned');
  }

  return result.uri;
}

/**
 * Open the Android installer for the downloaded APK.
 */
export async function installApk(fileUri: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(fileUri);

  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
