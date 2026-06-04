/**
 * WireGuard key generation using Node.js crypto.
 * WireGuard uses Curve25519 for key exchange.
 * We use the Web Crypto API available in Electron's renderer.
 */

/** Generate a WireGuard keypair (private + public) */
export async function generateKeypair(): Promise<{ privateKey: string; publicKey: string }> {
  // Generate X25519 keypair using Web Crypto
  const keyPair = await crypto.subtle.generateKey(
    { name: 'X25519' },
    true,
    ['deriveBits']
  ) as CryptoKeyPair

  // Export private key
  const privateRaw = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
  // The actual 32-byte Curve25519 private key is at bytes 16-48 of the PKCS8 wrapper
  const privateBytes = new Uint8Array(privateRaw).slice(16, 48)
  const privateKey = btoa(String.fromCharCode(...privateBytes))

  // Export public key
  const publicRaw = await crypto.subtle.exportKey('spki', keyPair.publicKey)
  // The actual 32-byte public key is at the end of the SPKI wrapper
  const publicBytes = new Uint8Array(publicRaw).slice(-32)
  const publicKey = btoa(String.fromCharCode(...publicBytes))

  return { privateKey, publicKey }
}

/** Generate a preshared key (random 32 bytes, base64) */
export function generatePresharedKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
