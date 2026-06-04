import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClientStore } from '../store/client-store'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { toast } from '../components/Toast'

export function ClientList() {
  const navigate = useNavigate()
  const { clients, loading, fetchClients } = useClientStore()
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newClientId, setNewClientId] = useState('')
  const [newIdError, setNewIdError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [basePath, setBasePath] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchClients()
    window.api.getBasePath().then(setBasePath)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        setShowNewDialog(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleCreateClient = () => {
    const slug = newClientId.trim().toLowerCase().replace(/\s+/g, '-')
    if (!slug) {
      setNewIdError('El ID es obligatorio')
      return
    }
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length > 1) {
      setNewIdError('Solo letras minúsculas, números y guiones')
      return
    }
    if (clients.some((c) => c.id === slug)) {
      setNewIdError('Ya existe un cliente con ese ID')
      return
    }
    setShowNewDialog(false)
    setNewClientId('')
    setNewIdError('')
    navigate(`/client/${slug}`)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await window.api.deleteClient(deleteTarget)
    setDeleteTarget(null)
    fetchClients()
  }

  const handleDuplicate = async (sourceId: string) => {
    const newId = sourceId + '-copia'
    if (clients.some(c => c.id === newId)) {
      toast('Ya existe una copia. Renombrala antes de duplicar de nuevo.', 'error')
      return
    }
    try {
      const data = await window.api.loadClient(sourceId)
      const newConfig = { ...data.config, id: newId, businessName: (data.config.businessName || '') + ' (copia)' }
      await window.api.saveClient(newId, newConfig, data.profile)
      toast(`Cliente duplicado como "${newId}"`, 'success')
      fetchClients()
    } catch (e: any) {
      toast(e.message || 'Error al duplicar', 'error')
    }
  }

  const handleImport = async () => {
    const result = await window.api.importClient()
    if (result) {
      toast(`Cliente "${result.id}" importado`, 'success')
      fetchClients()
    }
  }

  const handleChangeBasePath = async () => {
    const newPath = await window.api.setBasePath()
    if (newPath) {
      setBasePath(newPath)
      fetchClients()
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">Clientes</h1>
          <button
            onClick={handleChangeBasePath}
            className="text-xs text-gray-500 hover:text-gray-400 transition-colors mt-0.5"
            title="Click para cambiar directorio"
          >
            {basePath}
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/monitoring')}
            className="px-3 py-1.5 text-xs bg-green-600/20 hover:bg-green-600/30 text-green-300 border border-green-700/40 rounded transition-colors"
          >
            Monitoring
          </button>
          <button
            onClick={handleImport}
            className="px-3 py-1.5 text-xs bg-surface-3 hover:bg-surface-4 text-gray-300 rounded border border-border transition-colors"
          >
            Importar
          </button>
          <button
            onClick={() => setShowNewDialog(true)}
            className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded transition-colors flex items-center gap-1.5"
          >
            + Nuevo Cliente
            <kbd className="text-[9px] bg-white/10 px-1 py-0.5 rounded font-mono">⌘N</kbd>
          </button>
        </div>
      </div>

      {/* Search + stats */}
      {clients.length > 0 && (
        <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0">
          <div className="relative flex-1 max-w-xs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente..."
              className="w-full bg-surface-2 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div className="flex items-center gap-3 text-[10px] text-gray-600">
            <span>{clients.length} cliente{clients.length !== 1 ? 's' : ''}</span>
            <span>{clients.filter(c => c.status === 'complete').length} completo{clients.filter(c => c.status === 'complete').length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}

      {/* Client Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <span className="text-sm text-gray-500">Cargando...</span>
          </div>
        ) : clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-500">
            <p className="text-sm mb-2">No hay clientes configurados</p>
            <p className="text-xs">Creá uno nuevo o importá una carpeta existente</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {clients.filter(c => {
              if (!search) return true
              const q = search.toLowerCase()
              return c.id.includes(q) || c.businessName.toLowerCase().includes(q)
            }).map((client) => (
              <div
                key={client.id}
                className="bg-surface-1 border border-border rounded-lg p-4 hover:border-border-light transition-colors group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-gray-200 truncate">
                      {client.businessName}
                    </h3>
                    <p className="text-xs text-gray-500 font-mono">{client.id}</p>
                  </div>
                  <span
                    className={`shrink-0 ml-2 px-1.5 py-0.5 text-[10px] rounded font-medium ${
                      client.status === 'complete'
                        ? 'bg-green-900/40 text-green-400'
                        : 'bg-yellow-900/40 text-yellow-400'
                    }`}
                  >
                    {client.status === 'complete' ? 'Completo' : 'Incompleto'}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-gray-500 mb-4">
                  <span>{client.hasProfile ? 'Perfil OK' : 'Sin perfil'}</span>
                  <span>{client.assetCount} assets</span>
                </div>

                <div className="flex gap-1.5">
                  <button
                    onClick={() => navigate(`/client/${client.id}`)}
                    className="flex-1 px-2 py-1.5 text-xs bg-surface-3 hover:bg-surface-4 text-gray-300 rounded border border-border transition-colors"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDuplicate(client.id)}
                    className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-surface-4 rounded border border-transparent hover:border-border transition-colors"
                    title="Duplicar cliente"
                  >
                    Duplicar
                  </button>
                  <button
                    onClick={() => setDeleteTarget(client.id)}
                    className="px-2 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded border border-transparent hover:border-red-900/40 transition-colors"
                    title="Eliminar cliente"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Client Dialog */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-2 border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Nuevo Cliente</h3>
            <div className="space-y-1 mb-4">
              <label className="text-xs text-gray-400">
                ID del cliente <span className="text-gray-600">(slug, ej: "mi-casino")</span>
              </label>
              <input
                type="text"
                value={newClientId}
                onChange={(e) => {
                  setNewClientId(e.target.value)
                  setNewIdError('')
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateClient()}
                placeholder="mi-casino"
                autoFocus
                className="w-full bg-surface-3 border border-border rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
              />
              {newIdError && <p className="text-xs text-red-400">{newIdError}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowNewDialog(false)
                  setNewClientId('')
                  setNewIdError('')
                }}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 bg-surface-3 rounded border border-border"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateClient}
                className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded"
              >
                Crear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar cliente"
        message={`¿Seguro que querés eliminar "${deleteTarget}"? Se borrarán todos los archivos de configuración.`}
        confirmLabel="Eliminar"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
