import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '../components/Toast'
import { generateKeypair, generatePresharedKey } from '../lib/wireguard-keys'
import { generateServerConf, generatePeerConf, getNextIp, EMPTY_VPN_CONFIG } from '../lib/vpn-generator'
import type { VpnConfig, VpnPeer } from '../lib/vpn-generator'
import { ConfirmDialog } from '../components/ConfirmDialog'

export function VpnManager() {
  const navigate = useNavigate()
  const [config, setConfig] = useState<VpnConfig>(EMPTY_VPN_CONFIG)
  const [loading, setLoading] = useState(true)
  const [showNewPeer, setShowNewPeer] = useState(false)
  const [newPeerName, setNewPeerName] = useState('')
  const [newPeerType, setNewPeerType] = useState<'admin' | 'operator' | 'machine'>('operator')
  const [creating, setCreating] = useState(false)
  const [previewConf, setPreviewConf] = useState<{ name: string; content: string } | null>(null)
  const [deletePeer, setDeletePeer] = useState<string | null>(null)
  const [showServerSetup, setShowServerSetup] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const data = await window.api.loadVpnConfig()
      if (data) setConfig(data as VpnConfig)
    } catch (e) {
      console.error('[VPN] Failed to load config:', e)
    }
    setLoading(false)
  }

  const saveConfig = async (newConfig: VpnConfig) => {
    setConfig(newConfig)
    await window.api.saveVpnConfig(newConfig)
  }

  const handleInitServer = async () => {
    const keys = await generateKeypair()
    const endpoint = config.server.endpoint || 'TU_IP_PUBLICA:51820'
    const newConfig: VpnConfig = {
      ...config,
      server: { ...config.server, ...keys, endpoint },
    }
    await saveConfig(newConfig)
    toast('Server inicializado con nuevas keys', 'success')
  }

  const handleCreatePeer = async () => {
    if (!newPeerName.trim()) return
    setCreating(true)
    try {
      const keys = await generateKeypair()
      const psk = generatePresharedKey()
      const ip = getNextIp(config)

      const peer: VpnPeer = {
        id: crypto.randomUUID(),
        name: newPeerName.trim(),
        type: newPeerType,
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        presharedKey: psk,
        assignedIp: ip,
        enabled: true,
        createdAt: new Date().toISOString(),
      }

      const newConfig = {
        ...config,
        peers: [...config.peers, peer],
        nextIp: config.nextIp + 1,
      }
      await saveConfig(newConfig)
      setShowNewPeer(false)
      setNewPeerName('')
      toast(`Peer "${peer.name}" creado (${ip})`, 'success')
    } catch (e: any) {
      toast(e.message || 'Error creando peer', 'error')
    }
    setCreating(false)
  }

  const handleTogglePeer = async (peerId: string) => {
    const newPeers = config.peers.map(p =>
      p.id === peerId ? { ...p, enabled: !p.enabled } : p
    )
    await saveConfig({ ...config, peers: newPeers })
  }

  const handleDeletePeer = async () => {
    if (!deletePeer) return
    const newPeers = config.peers.filter(p => p.id !== deletePeer)
    await saveConfig({ ...config, peers: newPeers })
    setDeletePeer(null)
    toast('Peer eliminado', 'info')
  }

  const handleShowPeerConf = (peer: VpnPeer) => {
    const content = generatePeerConf(config.server, peer)
    setPreviewConf({ name: `${peer.name}.conf`, content })
  }

  const handleShowServerConf = () => {
    const content = generateServerConf(config)
    setPreviewConf({ name: 'wg0.conf', content })
  }

  const handleDownloadConf = (name: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const typeLabels = { admin: 'Admin', operator: 'Operador', machine: 'Maquina' }
  const typeColors = {
    admin: 'bg-purple-900/30 text-purple-400',
    operator: 'bg-blue-900/30 text-blue-400',
    machine: 'bg-gray-800 text-gray-400',
  }

  const hasServer = !!config.server.privateKey

  if (loading) return <div className="flex items-center justify-center h-full text-sm text-gray-500">Cargando...</div>

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-100">VPN</h1>
          <span className="text-xs text-gray-600">WireGuard</span>
          {hasServer && (
            <span className="text-[10px] px-2 py-0.5 bg-green-900/30 text-green-400 rounded-full">
              {config.peers.filter(p => p.enabled).length} peers activos
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasServer && (
            <>
              <button
                onClick={handleShowServerConf}
                className="px-3 py-1.5 text-xs bg-surface-3 hover:bg-surface-4 text-gray-300 rounded border border-border"
              >
                Ver server config
              </button>
              <button
                onClick={() => setShowNewPeer(true)}
                className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded"
              >
                + Nuevo Peer
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Server setup */}
        {!hasServer ? (
          <div className="max-w-lg mx-auto text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-2 border border-border flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-gray-200 mb-2">Configurar VPN Server</h2>
            <p className="text-xs text-gray-500 mb-1">Aurum genera configs de WireGuard para anonimizar todo el trafico.</p>
            <p className="text-xs text-gray-600 mb-6">Necesitas un VPS barato ($5/mes) con IP publica para el server.</p>

            <div className="space-y-3 text-left bg-surface-1 border border-border rounded-xl p-4 mb-6">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500">IP publica del server VPN (o dominio)</label>
                <input
                  value={config.server.endpoint}
                  onChange={(e) => setConfig({ ...config, server: { ...config.server, endpoint: e.target.value } })}
                  placeholder="123.45.67.89:51820"
                  className="w-full bg-surface-2 border border-border rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500">DNS</label>
                <input
                  value={config.server.dns}
                  onChange={(e) => setConfig({ ...config, server: { ...config.server, dns: e.target.value } })}
                  className="w-full bg-surface-2 border border-border rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <button
              onClick={handleInitServer}
              className="px-6 py-2.5 text-xs bg-accent hover:bg-accent-hover text-white rounded-lg"
            >
              Generar keys e inicializar
            </button>

            {/* Setup instructions */}
            <div className="mt-8 text-left">
              <button
                onClick={() => setShowServerSetup(!showServerSetup)}
                className="text-xs text-accent hover:text-accent-hover"
              >
                {showServerSetup ? 'Ocultar' : 'Ver'} instrucciones de setup del server
              </button>
              {showServerSetup && (
                <div className="mt-3 bg-surface-1 border border-border rounded-xl p-4 text-[11px] font-mono text-gray-400 space-y-2">
                  <p className="text-gray-300 font-sans text-xs font-medium mb-2">En el VPS (Ubuntu):</p>
                  <p># 1. Instalar WireGuard</p>
                  <p>sudo apt update && sudo apt install -y wireguard</p>
                  <p className="mt-2"># 2. Habilitar IP forwarding</p>
                  <p>echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf</p>
                  <p>sudo sysctl -p</p>
                  <p className="mt-2"># 3. Copiar la config generada por Aurum</p>
                  <p>sudo nano /etc/wireguard/wg0.conf</p>
                  <p className="mt-2"># 4. Iniciar y habilitar</p>
                  <p>sudo systemctl enable --now wg-quick@wg0</p>
                  <p className="mt-2"># 5. Verificar</p>
                  <p>sudo wg show</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Peers list */
          <div className="max-w-3xl space-y-4">
            {/* Server info strip */}
            <div className="bg-surface-1 border border-border rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-300">Server</p>
                <p className="text-[10px] font-mono text-gray-500 mt-0.5">{config.server.endpoint || 'Sin endpoint'}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-gray-500">Subnet: {config.server.subnet}</p>
                <p className="text-[10px] text-gray-600">DNS: {config.server.dns}</p>
              </div>
            </div>

            {/* Peers */}
            {config.peers.length === 0 ? (
              <div className="text-center py-8 text-gray-600">
                <p className="text-xs mb-1">Sin peers configurados</p>
                <p className="text-[10px]">Crea un peer para cada operador o maquina que necesite VPN</p>
              </div>
            ) : (
              <div className="space-y-2">
                {config.peers.map(peer => (
                  <div
                    key={peer.id}
                    className={`bg-surface-1 border rounded-xl p-4 transition-colors ${
                      peer.enabled ? 'border-border' : 'border-border/30 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${peer.enabled ? 'bg-green-500' : 'bg-gray-600'}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-200">{peer.name}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${typeColors[peer.type]}`}>
                              {typeLabels[peer.type]}
                            </span>
                          </div>
                          <p className="text-[10px] font-mono text-gray-600 mt-0.5">{peer.assignedIp}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleShowPeerConf(peer)}
                          className="px-2 py-1 text-[10px] bg-surface-3 hover:bg-surface-4 text-gray-400 rounded border border-border"
                        >
                          Ver config
                        </button>
                        <button
                          onClick={() => handleTogglePeer(peer.id)}
                          className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                            peer.enabled
                              ? 'bg-green-900/20 border-green-900/30 text-green-400 hover:bg-green-900/30'
                              : 'bg-surface-3 border-border text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {peer.enabled ? 'Activo' : 'Inactivo'}
                        </button>
                        <button
                          onClick={() => setDeletePeer(peer.id)}
                          className="px-2 py-1 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded border border-transparent hover:border-red-900/30"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* New peer modal */}
      {showNewPeer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-2 border border-border rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl animate-in">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Nuevo Peer</h3>
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Nombre</label>
                <input
                  value={newPeerName}
                  onChange={(e) => setNewPeerName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreatePeer()}
                  placeholder="Juan / PC-Chrome-1 / Mi PC"
                  autoFocus
                  className="w-full bg-surface-3 border border-border rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Tipo</label>
                <div className="flex gap-2">
                  {(['operator', 'machine', 'admin'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setNewPeerType(t)}
                      className={`flex-1 px-2 py-1.5 text-xs rounded border transition-colors ${
                        newPeerType === t
                          ? 'bg-accent/15 border-accent/40 text-accent'
                          : 'bg-surface-3 border-border text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {typeLabels[t]}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-gray-600">
                IP asignada: <span className="font-mono text-gray-400">{getNextIp(config)}</span>
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowNewPeer(false); setNewPeerName('') }} className="px-3 py-1.5 text-xs text-gray-400 bg-surface-3 rounded border border-border">
                Cancelar
              </button>
              <button
                onClick={handleCreatePeer}
                disabled={creating || !newPeerName.trim()}
                className="px-4 py-1.5 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded"
              >
                {creating ? 'Generando keys...' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Config preview modal */}
      {previewConf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-2 border border-border rounded-xl p-5 max-w-lg w-full mx-4 shadow-2xl animate-in">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-200 font-mono">{previewConf.name}</h3>
              <button onClick={() => setPreviewConf(null)} className="text-xs text-gray-500 hover:text-gray-300">Cerrar</button>
            </div>
            <pre className="bg-surface-0 border border-border rounded-lg p-4 text-[10px] font-mono text-gray-400 leading-relaxed overflow-auto max-h-80 whitespace-pre-wrap">
              {previewConf.content}
            </pre>
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => { navigator.clipboard.writeText(previewConf.content); toast('Copiado al clipboard', 'success') }}
                className="px-3 py-1.5 text-xs bg-surface-3 hover:bg-surface-4 text-gray-300 rounded border border-border"
              >
                Copiar
              </button>
              <button
                onClick={() => handleDownloadConf(previewConf.name, previewConf.content)}
                className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded"
              >
                Descargar .conf
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deletePeer}
        title="Eliminar peer"
        message="Este peer perdera acceso a la VPN. La config que tenga instalada dejara de funcionar."
        confirmLabel="Eliminar"
        danger
        onConfirm={handleDeletePeer}
        onCancel={() => setDeletePeer(null)}
      />
    </div>
  )
}
