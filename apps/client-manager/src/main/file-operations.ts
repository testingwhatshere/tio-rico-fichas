import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  renameSync,
  unlinkSync,
} from 'fs'
import { join, basename, resolve } from 'path'
import { app } from 'electron'

// ── Types ────────────────────────────────────────────────────────

interface ClientSummary {
  id: string
  businessName: string
  status: 'complete' | 'incomplete'
  hasProfile: boolean
  assetCount: number
}

interface ClientData {
  config: Record<string, unknown>
  profile: Record<string, string> | null
  assets: string[]
}

const REQUIRED_FIELDS = ['id', 'businessName', 'gamePanelUrl', 'apiUrl', 'botApiKey', 'jwtSecret']
// const REQUIRED_ASSETS = ['icon.png', 'adaptive-icon.png', 'splash.png'] // Reserved for future asset validation

// ── Safety Helpers ───────────────────────────────────────────────

/**
 * Atomic write: write to .tmp then rename.
 * rename() is atomic on POSIX and NTFS — if the process crashes mid-write,
 * the original file remains intact.
 */
function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp'
  writeFileSync(tmpPath, content, 'utf-8')
  try {
    renameSync(tmpPath, filePath)
  } catch (err) {
    // Clean up temp file if rename fails
    try { unlinkSync(tmpPath) } catch {}
    throw err
  }
}

/**
 * Safe JSON parse: returns null on failure instead of crashing the app.
 * Callers decide what to do with null (show error, use defaults, try backup).
 */
function safeParseJSON<T = Record<string, unknown>>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (err) {
    console.error(`[FileOps] Failed to parse ${filePath}:`, (err as Error).message)
    return null
  }
}

/**
 * Reject client IDs that contain path traversal characters or are otherwise unsafe.
 * Valid IDs: alphanumeric, hyphens, underscores. No dots at start, no slashes.
 */
function sanitizeClientId(id: string): void {
  if (!id || /[\/\\]|\.\./.test(id) || id.startsWith('.') || id.includes('\0')) {
    throw new Error(`Invalid client ID: "${id}"`)
  }
}

/**
 * Reject file names with path traversal or null bytes.
 */
function sanitizeFileName(name: string): void {
  if (!name || /[\/\\]|\.\./.test(name) || name.includes('\0')) {
    throw new Error(`Invalid file name: "${name}"`)
  }
}

/**
 * Create a timestamped backup of a file before overwriting.
 * Keeps at most `maxBackups` backups per file prefix, deletes oldest.
 */
function backupBeforeWrite(filePath: string, backupDir: string, maxBackups = 10): void {
  if (!existsSync(filePath)) return
  mkdirSync(backupDir, { recursive: true })

  const base = basename(filePath, '.json')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupName = `${base}_${timestamp}.json`

  try {
    copyFileSync(filePath, join(backupDir, backupName))
  } catch (err) {
    console.warn(`[FileOps] Backup failed for ${filePath}:`, (err as Error).message)
    return // Don't fail the save if backup fails
  }

  // Prune: keep only newest N backups for this file prefix
  try {
    const backups = readdirSync(backupDir)
      .filter(f => f.startsWith(base + '_') && f.endsWith('.json'))
      .sort() // ISO timestamps sort lexicographically
    while (backups.length > maxBackups) {
      const oldest = backups.shift()!
      try { unlinkSync(join(backupDir, oldest)) } catch {}
    }
  } catch {}
}

/**
 * Try to restore a config from backup if the main file is corrupted.
 * Returns the parsed content from the most recent backup, or null.
 */
function tryRestoreFromBackup<T>(clientDir: string, fileName: string): T | null {
  const backupDir = join(clientDir, 'backups')
  if (!existsSync(backupDir)) return null

  const base = basename(fileName, '.json')
  const backups = readdirSync(backupDir)
    .filter(f => f.startsWith(base + '_') && f.endsWith('.json'))
    .sort()
    .reverse() // Newest first

  for (const backup of backups) {
    const parsed = safeParseJSON<T>(join(backupDir, backup))
    if (parsed) {
      console.log(`[FileOps] Restored ${fileName} from backup: ${backup}`)
      return parsed
    }
  }
  return null
}

/** Simple per-client save lock to prevent concurrent writes */
const saveLocks = new Map<string, boolean>()

// ── Base Path ────────────────────────────────────────────────────

function getDefaultBasePath(): string {
  let dir = app.isPackaged ? process.resourcesPath : resolve(__dirname, '..', '..')
  for (let i = 0; i < 15; i++) {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = safeParseJSON<{ workspaces?: unknown }>(pkgPath)
      if (pkg?.workspaces) {
        return join(dir, 'clients')
      }
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return join(app.getPath('userData'), 'clients')
}

let basePath: string | null = null

export function getBasePath(): string {
  if (!basePath) {
    const settingsPath = join(app.getPath('userData'), 'client-manager-settings.json')
    if (existsSync(settingsPath)) {
      const settings = safeParseJSON<{ basePath?: string }>(settingsPath)
      if (settings?.basePath && existsSync(settings.basePath)) {
        basePath = settings.basePath
        return basePath
      }
    }
    basePath = getDefaultBasePath()
  }
  return basePath
}

export function setBasePath(newPath: string): void {
  basePath = newPath
  const settingsPath = join(app.getPath('userData'), 'client-manager-settings.json')
  atomicWriteFileSync(settingsPath, JSON.stringify({ basePath: newPath }, null, 2))
}

export function ensureBasePath(): void {
  const bp = getBasePath()
  console.log('[FileOps] Base path:', bp)
  if (!existsSync(bp)) {
    mkdirSync(bp, { recursive: true })
    console.log('[FileOps] Created base path:', bp)
  }
}

// ── Client CRUD ──────────────────────────────────────────────────

export function listClients(): ClientSummary[] {
  const bp = getBasePath()
  ensureBasePath()

  const entries = readdirSync(bp, { withFileTypes: true })
  const clients: ClientSummary[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const configPath = join(bp, entry.name, 'config.json')
    if (!existsSync(configPath)) continue

    try {
      let config = safeParseJSON(configPath)

      // If config is corrupted, try backup
      if (!config) {
        config = tryRestoreFromBackup(join(bp, entry.name), 'config.json')
      }

      const hasProfile = existsSync(join(bp, entry.name, 'panel-profile.json'))
      const assetsDir = join(bp, entry.name, 'assets')
      let assetCount = 0
      if (existsSync(assetsDir)) {
        assetCount = readdirSync(assetsDir).filter(f => /\.(png|svg|jpg|jpeg)$/i.test(f)).length
      }

      const missingFields = config
        ? REQUIRED_FIELDS.filter(f => !(config as Record<string, unknown>)[f])
        : REQUIRED_FIELDS
      const status = missingFields.length === 0 ? 'complete' : 'incomplete'

      clients.push({
        id: entry.name,
        businessName: (config as Record<string, unknown>)?.businessName as string || entry.name,
        status,
        hasProfile,
        assetCount,
      })
    } catch {
      clients.push({
        id: entry.name,
        businessName: entry.name,
        status: 'incomplete',
        hasProfile: false,
        assetCount: 0,
      })
    }
  }

  return clients.sort((a, b) => a.businessName.localeCompare(b.businessName))
}

export function loadClient(clientId: string): ClientData {
  sanitizeClientId(clientId)
  const bp = getBasePath()
  const clientDir = join(bp, clientId)

  if (!existsSync(clientDir)) {
    return { config: { id: clientId }, profile: null, assets: [] }
  }

  const configPath = join(clientDir, 'config.json')
  let config: Record<string, unknown> | null = existsSync(configPath)
    ? safeParseJSON(configPath)
    : null

  // If config is corrupted, try backup
  if (!config && existsSync(configPath)) {
    config = tryRestoreFromBackup(clientDir, 'config.json')
  }
  if (!config) {
    config = { id: clientId }
  }

  const profilePath = join(clientDir, 'panel-profile.json')
  const profile = existsSync(profilePath)
    ? safeParseJSON<Record<string, string>>(profilePath)
    : null

  const assetsDir = join(clientDir, 'assets')
  const assets = existsSync(assetsDir)
    ? readdirSync(assetsDir).filter(f => /\.(png|svg|jpg|jpeg)$/i.test(f))
    : []

  return { config, profile, assets }
}

export function saveClient(
  clientId: string,
  config: Record<string, unknown>,
  profile: Record<string, string> | null
): { success: boolean; path: string; error?: string } {
  sanitizeClientId(clientId)

  // Prevent concurrent saves for the same client
  if (saveLocks.get(clientId)) {
    return { success: false, path: '', error: 'Save already in progress for this client' }
  }
  saveLocks.set(clientId, true)

  try {
    const bp = getBasePath()
    const clientDir = join(bp, clientId)
    const backupDir = join(clientDir, 'backups')

    mkdirSync(join(clientDir, 'assets'), { recursive: true })

    // Backup existing files before overwriting
    backupBeforeWrite(join(clientDir, 'config.json'), backupDir)
    if (profile) {
      backupBeforeWrite(join(clientDir, 'panel-profile.json'), backupDir)
    }

    // Atomic writes
    atomicWriteFileSync(join(clientDir, 'config.json'), JSON.stringify(config, null, 2))
    if (profile) {
      atomicWriteFileSync(join(clientDir, 'panel-profile.json'), JSON.stringify(profile, null, 2))
    }

    return { success: true, path: clientDir }
  } catch (err) {
    console.error(`[FileOps] saveClient failed for ${clientId}:`, (err as Error).message)
    return { success: false, path: '', error: (err as Error).message }
  } finally {
    saveLocks.delete(clientId)
  }
}

export function deleteClient(clientId: string): { success: boolean; error?: string } {
  sanitizeClientId(clientId)
  try {
    const bp = getBasePath()
    const clientDir = join(bp, clientId)
    if (existsSync(clientDir)) {
      rmSync(clientDir, { recursive: true, force: true })
    }
    return { success: true }
  } catch (err) {
    console.error(`[FileOps] deleteClient failed for ${clientId}:`, (err as Error).message)
    return { success: false, error: (err as Error).message }
  }
}

export function importClient(sourcePath: string): { id: string } {
  const clientId = basename(sourcePath)
  sanitizeClientId(clientId)
  const bp = getBasePath()
  const targetDir = join(bp, clientId)

  if (existsSync(targetDir)) {
    throw new Error(`Client "${clientId}" already exists`)
  }

  try {
    copyDirRecursive(sourcePath, targetDir)
  } catch (err) {
    // Clean up partial copy on failure
    if (existsSync(targetDir)) {
      try { rmSync(targetDir, { recursive: true, force: true }) } catch {}
    }
    throw new Error(`Import failed: ${(err as Error).message}`)
  }

  return { id: clientId }
}

// ── Assets ───────────────────────────────────────────────────────

export function copyAssetToClient(clientId: string, filePath: string, fileName: string): void {
  sanitizeClientId(clientId)
  sanitizeFileName(fileName)
  if (!existsSync(filePath)) {
    throw new Error(`Source file not found: ${filePath}`)
  }
  const bp = getBasePath()
  const assetsDir = join(bp, clientId, 'assets')
  mkdirSync(assetsDir, { recursive: true })
  copyFileSync(filePath, join(assetsDir, fileName))
}

export function getAssetPath(clientId: string, fileName: string): string | null {
  sanitizeClientId(clientId)
  sanitizeFileName(fileName)
  const bp = getBasePath()
  const assetPath = join(bp, clientId, 'assets', fileName)
  return existsSync(assetPath) ? assetPath : null
}

// ── Commissions ──────────────────────────────────────────────────

export function loadCommissions(clientId: string): Record<string, unknown> | null {
  sanitizeClientId(clientId)
  const bp = getBasePath()
  const filePath = join(bp, clientId, 'commissions.json')
  if (!existsSync(filePath)) return null
  return safeParseJSON(filePath)
}

export function saveCommissions(clientId: string, data: Record<string, unknown>): void {
  sanitizeClientId(clientId)
  const bp = getBasePath()
  const clientDir = join(bp, clientId)
  mkdirSync(clientDir, { recursive: true })
  atomicWriteFileSync(join(clientDir, 'commissions.json'), JSON.stringify(data, null, 2))
}

// ── Deploy Files ─────────────────────────────────────────────────

export function saveDeployFiles(clientId: string, files: Record<string, string>): void {
  sanitizeClientId(clientId)
  const bp = getBasePath()
  const deployDir = join(bp, clientId, 'deploy')
  mkdirSync(deployDir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    sanitizeFileName(name)
    atomicWriteFileSync(join(deployDir, name), content)
  }
}

// ── Aurum Global Config ─────────────────────────────────────────

export function loadAurumConfig(): Record<string, unknown> {
  const bp = getBasePath()
  const filePath = join(bp, '..', 'aurum-config.json')
  if (!existsSync(filePath)) return {}
  return safeParseJSON(filePath) || {}
}

export function saveAurumConfig(data: Record<string, unknown>): void {
  const bp = getBasePath()
  atomicWriteFileSync(join(bp, '..', 'aurum-config.json'), JSON.stringify(data, null, 2))
}

// ── Runbook ──────────────────────────────────────────────────────

export function loadRunbook(filename: string): string | null {
  sanitizeFileName(filename)
  const bp = getBasePath()
  const runbookDir = join(bp, '..', 'runbook')
  const filePath = join(runbookDir, filename)
  if (!existsSync(filePath)) return null
  return readFileSync(filePath, 'utf-8')
}

// ── Client Costs ─────────────────────────────────────────────────

export function loadCosts(clientId: string): Record<string, unknown> | null {
  sanitizeClientId(clientId)
  const bp = getBasePath()
  const filePath = join(bp, clientId, 'costs.json')
  if (!existsSync(filePath)) return null
  return safeParseJSON(filePath)
}

export function saveCosts(clientId: string, data: Record<string, unknown>): void {
  sanitizeClientId(clientId)
  const bp = getBasePath()
  const clientDir = join(bp, clientId)
  mkdirSync(clientDir, { recursive: true })
  atomicWriteFileSync(join(clientDir, 'costs.json'), JSON.stringify(data, null, 2))
}

// ── VPN Config ───────────────────────────────────────────────────

export function loadVpnConfig(): Record<string, unknown> | null {
  const bp = getBasePath()
  const filePath = join(bp, '..', 'vpn', 'vpn-config.json')
  if (!existsSync(filePath)) return null
  return safeParseJSON(filePath)
}

export function saveVpnConfig(data: Record<string, unknown>): void {
  const bp = getBasePath()
  const vpnDir = join(bp, '..', 'vpn')
  mkdirSync(vpnDir, { recursive: true })
  atomicWriteFileSync(join(vpnDir, 'vpn-config.json'), JSON.stringify(data, null, 2))
}

// ── Helpers ──────────────────────────────────────────────────────

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}
