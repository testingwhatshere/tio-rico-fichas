import { ipcMain, dialog } from 'electron'
import {
  listClients,
  loadClient,
  saveClient,
  deleteClient,
  importClient,
  copyAssetToClient,
  getBasePath,
  setBasePath,
  loadCommissions,
  saveCommissions,
  saveDeployFiles,
  loadAurumConfig,
  saveAurumConfig,
  loadRunbook,
  loadCosts,
  saveCosts,
  loadVpnConfig,
  saveVpnConfig,
} from './file-operations'
import { parseMhtmlFile } from './mhtml-parser'

export function registerIpcHandlers(): void {
  ipcMain.handle('clients:list', () => {
    return listClients()
  })

  ipcMain.handle('clients:load', (_event, clientId: string) => {
    return loadClient(clientId)
  })

  ipcMain.handle('clients:save', (_event, clientId: string, config: Record<string, unknown>, profile: Record<string, string> | null) => {
    return saveClient(clientId, config, profile)
  })

  ipcMain.handle('clients:delete', (_event, clientId: string) => {
    return deleteClient(clientId)
  })

  ipcMain.handle('clients:import', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Seleccionar carpeta del cliente',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    try {
      return importClient(result.filePaths[0])
    } catch (err) {
      return { error: (err as Error).message }
    }
  })

  ipcMain.handle('dialog:pick-file', async (_event, filters?: { name: string; extensions: string[] }[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('assets:copy', (_event, clientId: string, filePath: string, fileName: string) => {
    try {
      copyAssetToClient(clientId, filePath, fileName)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('settings:get-base-path', () => {
    return getBasePath()
  })

  ipcMain.handle('settings:set-base-path', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Seleccionar directorio base para clientes',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    setBasePath(result.filePaths[0])
    return result.filePaths[0]
  })

  // Commissions
  ipcMain.handle('commissions:load', (_event, clientId: string) => {
    return loadCommissions(clientId)
  })

  ipcMain.handle('commissions:save', (_event, clientId: string, data: Record<string, unknown>) => {
    try {
      saveCommissions(clientId, data)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Deploy files
  ipcMain.handle('deploy:save', (_event, clientId: string, files: Record<string, string>) => {
    try {
      saveDeployFiles(clientId, files)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Aurum global config
  ipcMain.handle('aurum:load-config', () => loadAurumConfig())
  ipcMain.handle('aurum:save-config', (_event, data: Record<string, unknown>) => {
    try {
      saveAurumConfig(data)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Runbook
  ipcMain.handle('runbook:load', (_event, filename: string) => {
    return loadRunbook(filename)
  })

  // Costs
  ipcMain.handle('costs:load', (_event, clientId: string) => {
    return loadCosts(clientId)
  })

  ipcMain.handle('costs:save', (_event, clientId: string, data: Record<string, unknown>) => {
    try {
      saveCosts(clientId, data)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // VPN
  ipcMain.handle('vpn:load', () => {
    return loadVpnConfig()
  })

  ipcMain.handle('vpn:save', (_event, data: Record<string, unknown>) => {
    try {
      saveVpnConfig(data)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // MHTML
  ipcMain.handle('mhtml:load', async (_event, filePath?: string) => {
    let targetPath = filePath
    if (!targetPath) {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Web Pages', extensions: ['mhtml', 'mht', 'html', 'htm'] }],
        title: 'Cargar página del panel',
      })
      if (result.canceled || result.filePaths.length === 0) return null
      targetPath = result.filePaths[0]
    }
    return parseMhtmlFile(targetPath)
  })
}
