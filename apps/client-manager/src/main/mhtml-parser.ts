import { readFileSync } from 'fs'
import { extname } from 'path'

/**
 * Parses MHTML files into renderable HTML.
 * Also supports loading plain .html files directly.
 */
export function parseMhtmlFile(filePath: string): string {
  const ext = extname(filePath).toLowerCase()

  if (ext === '.html' || ext === '.htm') {
    return readFileSync(filePath, 'utf-8')
  }

  if (ext === '.mhtml' || ext === '.mht') {
    return parseMhtml(readFileSync(filePath))
  }

  throw new Error(`Unsupported file type: ${ext}`)
}

function parseMhtml(buffer: Buffer): string {
  const content = buffer.toString('utf-8')

  // Extract boundary from Content-Type header
  const boundaryMatch = content.match(/boundary="?([^"\r\n]+)"?/)
  if (!boundaryMatch) {
    // Not a valid MHTML, try to use as raw HTML
    if (content.includes('<html') || content.includes('<HTML')) {
      return content
    }
    throw new Error('No boundary found in MHTML file')
  }

  const boundary = boundaryMatch[1]
  const parts = content.split(`--${boundary}`)

  // Build a map of Content-ID/Content-Location → data URI for resource inlining
  const resourceMap = new Map<string, string>()
  let htmlPart: string | null = null

  for (const part of parts) {
    if (part.trim() === '' || part.trim() === '--') continue

    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd === -1) continue

    const headers = part.substring(0, headerEnd)
    const body = part.substring(headerEnd + 4)

    const contentType = extractHeader(headers, 'Content-Type') || ''
    const contentTransferEncoding = extractHeader(headers, 'Content-Transfer-Encoding') || ''
    const contentLocation = extractHeader(headers, 'Content-Location') || ''
    const contentId = extractHeader(headers, 'Content-ID')?.replace(/[<>]/g, '') || ''

    // Decode body based on transfer encoding
    let decodedBody = body
    if (contentTransferEncoding.toLowerCase() === 'quoted-printable') {
      decodedBody = decodeQuotedPrintable(body)
    } else if (contentTransferEncoding.toLowerCase() === 'base64') {
      // Keep as-is for binary resources, we'll use it as data URI
    }

    // Identify the main HTML part
    if (contentType.includes('text/html') && !htmlPart) {
      htmlPart = decodedBody
      continue
    }

    // Build data URI for resources (CSS, images, etc.)
    const mimeType = contentType.split(';')[0].trim()
    let dataUri: string

    if (contentTransferEncoding.toLowerCase() === 'base64') {
      const cleanBase64 = body.replace(/[\r\n\s]/g, '')
      dataUri = `data:${mimeType};base64,${cleanBase64}`
    } else {
      const base64 = Buffer.from(decodedBody, 'utf-8').toString('base64')
      dataUri = `data:${mimeType};base64,${base64}`
    }

    if (contentLocation) resourceMap.set(contentLocation, dataUri)
    if (contentId) resourceMap.set(`cid:${contentId}`, dataUri)
  }

  if (!htmlPart) {
    throw new Error('No HTML part found in MHTML')
  }

  // Replace resource references with data URIs
  let result = htmlPart
  for (const [url, dataUri] of resourceMap) {
    // Escape special regex chars in URL
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(escaped, 'g'), dataUri)
  }

  return result
}

function extractHeader(headers: string, name: string): string | null {
  const regex = new RegExp(`^${name}:\\s*(.+?)$`, 'im')
  const match = headers.match(regex)
  return match ? match[1].trim() : null
}

function decodeQuotedPrintable(input: string): string {
  return input
    // Remove soft line breaks
    .replace(/=\r?\n/g, '')
    // Decode =XX hex sequences
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex) => {
      return String.fromCharCode(parseInt(hex, 16))
    })
}
