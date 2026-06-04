import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';

/**
 * Compute SHA256 hash of a file.
 * - Native: reads file as base64 via expo-file-system, then hashes with expo-crypto
 * - Web: reads File/Blob as ArrayBuffer, then hashes with crypto.subtle
 */
export async function computeFileHash(file: {
  uri: string;
  file?: File;
}): Promise<string> {
  if (Platform.OS === 'web') {
    return computeFileHashWeb(file);
  }
  return computeFileHashNative(file.uri);
}

async function computeFileHashNative(uri: string): Promise<string> {
  // Read file as base64 string
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  // expo-crypto can hash base64 data
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    base64,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
}

async function computeFileHashWeb(file: { uri: string; file?: File }): Promise<string> {
  let arrayBuffer: ArrayBuffer;

  if (file.file) {
    arrayBuffer = await file.file.arrayBuffer();
  } else {
    const response = await fetch(file.uri);
    arrayBuffer = await response.arrayBuffer();
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get file size from a file reference.
 * - Web: use File.size
 * - Native: use expo-file-system getInfoAsync
 */
export async function getFileSize(file: {
  uri: string;
  file?: File;
}): Promise<number> {
  if (Platform.OS === 'web' && file.file) {
    return file.file.size;
  }
  if (Platform.OS === 'web') {
    const response = await fetch(file.uri);
    const blob = await response.blob();
    return blob.size;
  }
  const info = await FileSystem.getInfoAsync(file.uri);
  if (info.exists && 'size' in info) {
    return info.size;
  }
  return 0;
}
