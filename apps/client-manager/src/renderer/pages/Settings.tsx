import { useEffect, useState } from 'react'
import { FormField } from '../components/FormField'
import { toast } from '../components/Toast'

interface AurumConfig {
  internalTelegramBotToken: string
  internalTelegramChatId: string
  companyName: string
  adminEmail: string
}

const EMPTY: AurumConfig = {
  internalTelegramBotToken: '',
  internalTelegramChatId: '',
  companyName: '',
  adminEmail: '',
}

export function Settings() {
  const [config, setConfig] = useState<AurumConfig>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [basePath, setBasePath] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const data = await window.api.loadAurumConfig()
      if (data) setConfig({ ...EMPTY, ...(data as AurumConfig) })
      const bp = await window.api.getBasePath()
      setBasePath(bp)
    } catch {}
    setLoading(false)
  }

  const handleSave = async () => {
    await window.api.saveAurumConfig(config)
    toast('Configuracion guardada', 'success')
  }

  const handleChangePath = async () => {
    const newPath = await window.api.setBasePath()
    if (newPath) {
      setBasePath(newPath)
      toast('Directorio cambiado', 'success')
    }
  }

  if (loading) return <div className="flex items-center justify-center h-full text-sm text-gray-500">Cargando...</div>

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <h1 className="text-lg font-semibold text-gray-100">Configuracion</h1>
        <button onClick={handleSave} className="px-4 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded">
          Guardar
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-lg space-y-6">
          {/* General */}
          <Section title="General">
            <FormField
              label="Nombre de la empresa"
              value={config.companyName}
              onChange={v => setConfig({ ...config, companyName: v })}
              placeholder="Mi Empresa"
            />
            <FormField
              label="Email admin"
              value={config.adminEmail}
              onChange={v => setConfig({ ...config, adminEmail: v })}
              placeholder="admin@miempresa.com"
            />
          </Section>

          {/* Telegram interno */}
          <Section title="Telegram interno (alertas de todos los clientes)">
            <p className="text-[10px] text-gray-600 -mt-1 mb-3">
              Bot propio para recibir alertas de health checks, fallos, y eventos de todos los clientes.
              Crear con @BotFather en Telegram.
            </p>
            <FormField
              label="Bot Token"
              value={config.internalTelegramBotToken}
              onChange={v => setConfig({ ...config, internalTelegramBotToken: v })}
              type="password"
              placeholder="123456:ABC-DEF..."
            />
            <FormField
              label="Chat ID (grupo o personal)"
              value={config.internalTelegramChatId}
              onChange={v => setConfig({ ...config, internalTelegramChatId: v })}
              placeholder="-1001234567890"
            />
          </Section>

          {/* Storage */}
          <Section title="Almacenamiento">
            <div className="flex items-center justify-between p-3 bg-surface-1 border border-border rounded-lg">
              <div>
                <p className="text-xs text-gray-300">Directorio de clientes</p>
                <p className="text-[10px] font-mono text-gray-600 mt-0.5">{basePath}</p>
              </div>
              <button
                onClick={handleChangePath}
                className="px-3 py-1.5 text-[10px] bg-surface-3 hover:bg-surface-4 text-gray-400 rounded border border-border"
              >
                Cambiar
              </button>
            </div>
          </Section>

          {/* About */}
          <Section title="Acerca de">
            <div className="flex items-center gap-3 p-3 bg-surface-1 border border-border rounded-lg">
              <div className="w-10 h-10 rounded-lg bg-surface-2 border border-border flex items-center justify-center">
                <span className="text-lg font-bold" style={{ color: '#c9983a' }}>A</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-200">Aurum</p>
                <p className="text-[10px] text-gray-500">Client Manager v1.0.0</p>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  )
}
